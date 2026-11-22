import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * TÉLÉMATIQUE DES VÉHICULES DE LOCATION.
 *
 * Confier une Maextro S800 à 900 000 F la journée à quelqu'un qu'on a vu une fois,
 * sans savoir où elle est, est un risque qu'aucun loueur sérieux ne prend.
 *
 * Ces tests verrouillent les trois règles qui font que l'outil reste légitime :
 * on ne suit pas un client hors location, on n'arrête pas un moteur en roulant, et
 * une immobilisation exige deux personnes.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };
type App = Awaited<ReturnType<typeof buildApp>>['app'];

async function louer(app: App): Promise<{ reservationId: string; vehiculeId: string }> {
  const r = await app.inject({
    method: 'POST', url: '/rental/reserve',
    payload: {
      formula: 'evenement', vehicleId: 'aito-m9', duree: 'journee', userId: 'client-aya',
      lieu: 'Hôtel Ivoire, Cocody',
      contact: { nom: 'Aya Kouassi', telephone: '0708091011' },
    },
  });
  assert.ok(r.statusCode === 200 || r.statusCode === 201, `réservation : ${r.statusCode} ${r.body}`);
  const reservation = r.json().reservation;
  await app.inject({ method: 'POST', url: `/admin/rental/${reservation.id}/status`, headers: A, payload: { status: 'en_cours' } });
  return { reservationId: reservation.id, vehiculeId: 'aito-m9' };
}

const remonter = (app: App, vehiculeId: string, p: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/rental/telematique/${vehiculeId}`, payload: p });

test('la position d’un véhicule loué se voit, et chaque consultation est tracée', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { vehiculeId } = await louer(app);

  await remonter(app, vehiculeId, { lat: 5.3596, lng: -3.9903, vitesseKmh: 42, contact: true, batteriePct: 71 });

  const r = await app.inject({ method: 'GET', url: `/admin/rental/vehicules/${vehiculeId}/position?motif=Retard de restitution`, headers: A });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().position.vitesseKmh, 42);
  // Le quartier réel et la commune (limites OSM), jamais deux décimales.
  assert.match(r.json().position.zone, /^[^\d].*, Cocody$/, r.json().position.zone);

  // La consultation laisse une trace nominative : c'est ce qui rend l'outil légitime.
  const journal = r.json().journal;
  assert.ok(journal.length >= 1);
  assert.equal(journal[0].motif, 'Retard de restitution');
  assert.equal(journal[0].par, 'Super Admin');
});

test('hors location et hors vol, la position n’est pas consultable', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  await remonter(app, 'nio-es9', { lat: 5.33, lng: -4.01, vitesseKmh: 0, contact: false });

  // Un loueur qui regarde où dort son client le dimanche commet une faute.
  const r = await app.inject({ method: 'GET', url: '/admin/rental/vehicules/nio-es9/position', headers: A });
  assert.equal(r.statusCode, 403);
  assert.match(r.json().error.message, /pas consultable/);
});

test('la flotte en location se supervise d’un seul écran, locataire joignable', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { vehiculeId } = await louer(app);
  await remonter(app, vehiculeId, { lat: 5.3596, lng: -3.9903, vitesseKmh: 0, contact: false, batteriePct: 64 });

  const r = await app.inject({ method: 'GET', url: '/admin/rental/flotte/positions', headers: A });
  assert.equal(r.statusCode, 200, r.body);
  const v = r.json().vehicules.find((x: { vehiculeId: string }) => x.vehiculeId === vehiculeId);
  assert.ok(v);
  assert.equal(v.locataire.nom, 'Aya Kouassi');
  assert.equal(v.locataire.telephone, '0708091011', 'on doit pouvoir appeler le locataire sans chercher');
  assert.equal(v.silencieux, false);
  assert.equal(v.position.batteriePct, 64);
});

test('un vol produit une fiche de signalement exploitable par un commissariat', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { reservationId, vehiculeId } = await louer(app);
  await remonter(app, vehiculeId, { lat: 5.3456, lng: -4.0864, vitesseKmh: 0, contact: false });

  const d = await app.inject({
    method: 'POST', url: `/admin/rental/${reservationId}/vol`, headers: A,
    payload: { circonstances: 'Véhicule non restitué à l’échéance, locataire injoignable depuis 18 h.' },
  });
  assert.equal(d.statusCode, 201, d.body);
  const vol = d.json().vol;
  assert.equal(vol.statut, 'declare');
  assert.ok(vol.dernierePosition, 'la dernière position connue doit être figée à la déclaration');
  // Les numéros de secours sont donnés avec la déclaration : on appelle tout de suite.
  assert.ok(d.json().contactsPolice.some((c: { numero: string }) => c.numero === '170'));

  const pdf = await app.inject({ method: 'GET', url: `/admin/rental/vol/${vol.id}/signalement.pdf`, headers: A });
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  const texte = pdf.rawPayload.toString('latin1');
  // Sans ce document, l'agent dicte au téléphone et se trompe d'immatriculation.
  assert.match(texte, /FICHE DE SIGNALEMENT/);
  assert.match(texte, /Aya Kouassi/);
  assert.match(texte, /0708091011/);
  assert.match(texte, /5\.345600, -4\.086400/);

  // Une fois la position consultable au titre du vol, même sans location active.
  const transmis = await app.inject({
    method: 'POST', url: `/admin/rental/vol/${vol.id}/transmis`, headers: A,
    payload: { a: 'Commissariat du 1er arrondissement, Plateau', referencePlainte: 'PV-2026-4471' },
  });
  assert.equal(transmis.statusCode, 200);
  assert.equal(transmis.json().vol.statut, 'transmis');
  assert.equal(transmis.json().vol.referencePlainte, 'PV-2026-4471');
});

test('on n’arrête pas un moteur en roulant, et jamais tout seul', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { reservationId, vehiculeId } = await louer(app);
  // Véhicule lancé sur le boulevard.
  await remonter(app, vehiculeId, { lat: 5.3596, lng: -3.9903, vitesseKmh: 78, contact: true });

  const arme = await app.inject({
    method: 'POST', url: `/admin/rental/vehicules/${vehiculeId}/immobiliser`, headers: A,
    payload: { motif: 'vol', commentaire: 'Véhicule déclaré volé, locataire injoignable.', reservationId },
  });
  assert.equal(arme.statusCode, 201, arme.body);
  const immo = arme.json().immobilisation;
  assert.equal(immo.etat, 'armee', 'armée, pas appliquée');
  assert.match(arme.json().avertissement, /confirmé par une seconde personne/);

  // Celui qui arme ne confirme pas : le client se retrouve à pied, parfois la nuit.
  const auto = await app.inject({ method: 'POST', url: `/admin/rental/immobilisations/${immo.id}/confirmer`, headers: A });
  assert.equal(auto.statusCode, 403);
  assert.match(auto.json().error.message, /deux personnes/);

  // Un second compte confirme.
  const c = await app.inject({ method: 'POST', url: '/admin/accounts', headers: A, payload: { name: 'Rose Aké', role: 'ops' } });
  const { account, motDePasseProvisoire } = c.json();
  const l = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: account.username, password: motDePasseProvisoire } });
  const h = { authorization: `Bearer ${l.json().token}` };

  const conf = await app.inject({ method: 'POST', url: `/admin/rental/immobilisations/${immo.id}/confirmer`, headers: h });
  assert.equal(conf.statusCode, 200, conf.body);
  assert.equal(conf.json().immobilisation.etat, 'armee', 'le véhicule roule : la coupure attend');
  assert.match(conf.json().avertissement, /dès que le véhicule roulera à moins de 5 km\/h/);

  // Le véhicule s'arrête : c'est le boîtier qui applique, pas l'écran.
  await remonter(app, vehiculeId, { lat: 5.3601, lng: -3.9910, vitesseKmh: 2, contact: true });
  const apres = await app.inject({ method: 'GET', url: '/admin/rental/flotte/positions', headers: A });
  const v = apres.json().vehicules.find((x: { vehiculeId: string }) => x.vehiculeId === vehiculeId);
  assert.equal(v.immobilisation.etat, 'appliquee');

  const levee = await app.inject({
    method: 'POST', url: `/admin/rental/immobilisations/${immo.id}/lever`, headers: A,
    payload: { motif: 'Véhicule retrouvé et restitué au dépôt.' },
  });
  assert.equal(levee.statusCode, 200);
  assert.equal(levee.json().immobilisation.etat, 'levee');
});

test('deux immobilisations ne se superposent pas sur le même véhicule', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { vehiculeId } = await louer(app);
  const payload = { motif: 'impaye', commentaire: 'Deuxième échéance non réglée malgré relance.' };

  assert.equal((await app.inject({ method: 'POST', url: `/admin/rental/vehicules/${vehiculeId}/immobiliser`, headers: A, payload })).statusCode, 201);
  const doublon = await app.inject({ method: 'POST', url: `/admin/rental/vehicules/${vehiculeId}/immobiliser`, headers: A, payload });
  assert.equal(doublon.statusCode, 409);
});
