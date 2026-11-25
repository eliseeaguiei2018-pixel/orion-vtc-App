import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * CAISSE NOMINATIVE.
 *
 * Une partie de l'argent d'ORION arrive en espèces, passe par les mains d'une
 * personne, et se compte à la main en fin de journée. Tant que cette étape n'est pas
 * outillée, elle se fait sur un cahier et le rapport financier de l'entreprise ignore
 * une part réelle de ses encaissements.
 *
 * Ces tests vérifient ce qui fait qu'une caisse est une caisse : elle est nominative,
 * on n'en sort pas plus qu'elle ne contient, l'écart n'est jamais effacé en silence,
 * et personne ne valide son propre arrêté.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };
type App = Awaited<ReturnType<typeof buildApp>>['app'];

/** Crée une trésorière et renvoie ses en-têtes de session. */
async function tresoriere(app: App, nom: string): Promise<Record<string, string>> {
  const c = await app.inject({ method: 'POST', url: '/admin/accounts', headers: A, payload: { name: nom, role: 'tresorier', service: 'Finances' } });
  assert.equal(c.statusCode, 200, c.body);
  const { account, motDePasseProvisoire } = c.json();
  const l = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: account.username, password: motDePasseProvisoire } });
  assert.equal(l.statusCode, 200, l.body);
  return { authorization: `Bearer ${l.json().token}` };
}

test('une trésorière ouvre sa caisse, encaisse, et le solde théorique suit', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const h = await tresoriere(app, 'Rose Aké');

  const ouverture = await app.inject({ method: 'POST', url: '/admin/caisses', headers: h, payload: { fondDeCaisse: 50_000, emplacement: 'Siège — Plateau' } });
  assert.equal(ouverture.statusCode, 200, ouverture.body);
  const caisse = ouverture.json().caisse;
  assert.equal(caisse.statut, 'ouverte');
  assert.equal(caisse.soldeTheorique, 50_000);

  // Deux caisses ouvertes au même nom, et plus personne ne sait où est l'argent.
  const seconde = await app.inject({ method: 'POST', url: '/admin/caisses', headers: h, payload: { fondDeCaisse: 10_000 } });
  assert.equal(seconde.statusCode, 409);

  for (const m of [
    { montant: 12_500, origine: 'commission_chauffeur', tiers: 'Konan Yao (AB-114-CI)' },
    { montant: 8_000, origine: 'commission_chauffeur', tiers: 'Awa Diomandé (AB-220-CI)' },
    { montant: 150_000, origine: 'location', tiers: 'Ivoire Logistics SA' },
  ]) {
    const r = await app.inject({ method: 'POST', url: `/admin/caisses/${caisse.id}/encaisser`, headers: h, payload: m });
    assert.equal(r.statusCode, 200, r.body);
  }

  const etat = (await app.inject({ method: 'GET', url: `/admin/caisses/${caisse.id}`, headers: h })).json().caisse;
  assert.equal(etat.entrees, 170_500);
  assert.equal(etat.soldeTheorique, 220_500);
  assert.equal(etat.parOrigine.commission_chauffeur, 20_500);
  assert.equal(etat.parOrigine.location, 150_000);
});

test('on ne sort pas d’une caisse plus qu’elle ne contient', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const h = await tresoriere(app, 'Nadège Tanoh');
  const caisse = (await app.inject({ method: 'POST', url: '/admin/caisses', headers: h, payload: { fondDeCaisse: 20_000 } })).json().caisse;

  // Une caisse négative n'existe pas dans le monde réel ; l'accepter à l'écran
  // revient à masquer une erreur de saisie jusqu'à l'arrêté.
  const trop = await app.inject({
    method: 'POST', url: `/admin/caisses/${caisse.id}/decaisser`, headers: h,
    payload: { montant: 100_000, sortie: 'avance_chauffeur', tiers: 'Mamadou Bamba' },
  });
  assert.equal(trop.statusCode, 409);
  assert.match(trop.json().error, /supérieur à ce que contient la caisse/);

  const ok = await app.inject({
    method: 'POST', url: `/admin/caisses/${caisse.id}/decaisser`, headers: h,
    payload: { montant: 15_000, sortie: 'depense', note: 'Fournitures de bureau' },
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().caisse.soldeTheorique, 5_000);
});

test('le comptage par coupures donne le total, et l’écart est constaté sans être effacé', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const h = await tresoriere(app, 'Clarisse Yao');
  const caisse = (await app.inject({ method: 'POST', url: '/admin/caisses', headers: h, payload: { fondDeCaisse: 0 } })).json().caisse;
  await app.inject({ method: 'POST', url: `/admin/caisses/${caisse.id}/encaisser`, headers: h, payload: { montant: 100_000, origine: 'autre' } });

  // Comptage à blanc : 9 × 10 000 + 1 × 5 000 + 2 × 1 000 = 97 000.
  const blanc = await app.inject({
    method: 'POST', url: `/admin/caisses/${caisse.id}/comptage`, headers: h,
    payload: { comptage: { 10000: 9, 5000: 1, 1000: 2 } },
  });
  assert.equal(blanc.statusCode, 200, blanc.body);
  assert.equal(blanc.json().montantCompte, 97_000);
  assert.equal(blanc.json().montantAttendu, 100_000);
  assert.equal(blanc.json().ecart, -3_000);

  // Un manquant de 3 000 F sans explication n'est pas un arrêté, c'est un trou.
  const sansMotif = await app.inject({
    method: 'POST', url: `/admin/caisses/${caisse.id}/arreter`, headers: h,
    payload: { comptage: { 10000: 9, 5000: 1, 1000: 2 } },
  });
  assert.equal(sansMotif.statusCode, 400);
  assert.match(sansMotif.json().error, /motif écrit est obligatoire/);

  const avecMotif = await app.inject({
    method: 'POST', url: `/admin/caisses/${caisse.id}/arreter`, headers: h,
    payload: {
      comptage: { 10000: 9, 5000: 1, 1000: 2 },
      motifEcart: 'Rendu de monnaie erroné sur une location, client reparti.',
      verseEnBanque: 90_000,
    },
  });
  assert.equal(avecMotif.statusCode, 200, avecMotif.body);
  const arretee = avecMotif.json().caisse;
  assert.equal(arretee.statut, 'arretee');
  assert.equal(arretee.montantCompte, 97_000);
  assert.equal(arretee.ecart, -3_000, 'l’écart est conservé, jamais corrigé en silence');
  assert.equal(arretee.verseEnBanque, 90_000);
  // Le versement figure au journal, sinon l'arrêté suivant repartirait d'un solde faux.
  assert.ok(arretee.mouvements.some((m: { sortie?: string; montant: number }) => m.sortie === 'versement_banque' && m.montant === 90_000));

  // Une caisse arrêtée n'encaisse plus.
  const apres = await app.inject({ method: 'POST', url: `/admin/caisses/${caisse.id}/encaisser`, headers: h, payload: { montant: 1_000, origine: 'autre' } });
  assert.equal(apres.statusCode, 409);
});

test('personne ne touche la caisse d’une autre, et nul ne valide son propre arrêté', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const rose = await tresoriere(app, 'Rose Aké');
  const salimata = await tresoriere(app, 'Salimata Dosso');

  const caisse = (await app.inject({ method: 'POST', url: '/admin/caisses', headers: rose, payload: { fondDeCaisse: 10_000 } })).json().caisse;

  const intrusion = await app.inject({
    method: 'POST', url: `/admin/caisses/${caisse.id}/encaisser`, headers: salimata,
    payload: { montant: 5_000, origine: 'autre' },
  });
  assert.equal(intrusion.statusCode, 403);
  assert.match(intrusion.json().error.message ?? intrusion.json().error, /autre personne/);

  await app.inject({ method: 'POST', url: `/admin/caisses/${caisse.id}/arreter`, headers: rose, payload: { montantCompte: 10_000 } });

  // Une trésorière n'a pas finance:write : elle ne valide aucun arrêté, pas même
  // celui d'une collègue. Et la direction ne valide pas le sien non plus.
  const parElle = await app.inject({ method: 'POST', url: `/admin/caisses/${caisse.id}/valider`, headers: rose });
  assert.equal(parElle.statusCode, 403);

  const parLaDirection = await app.inject({ method: 'POST', url: `/admin/caisses/${caisse.id}/valider`, headers: A });
  assert.equal(parLaDirection.statusCode, 200, parLaDirection.body);
  assert.ok(parLaDirection.json().caisse.valideLe);
});

test('les caisses alimentent le rapport financier de la direction', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const h = await tresoriere(app, 'Rose Aké');
  const caisse = (await app.inject({ method: 'POST', url: '/admin/caisses', headers: h, payload: { fondDeCaisse: 0 } })).json().caisse;
  await app.inject({ method: 'POST', url: `/admin/caisses/${caisse.id}/encaisser`, headers: h, payload: { montant: 240_000, origine: 'commission_chauffeur', tiers: 'Tournée du vendredi' } });

  // Sans cette ligne, cet argent n'apparaîtrait nulle part dans les comptes.
  const direction = await app.inject({ method: 'GET', url: '/admin/executive', headers: A });
  assert.equal(direction.statusCode, 200, direction.body);
  const k = direction.json().consolidation;
  assert.equal(k.caisses.ouvertes, 1);
  assert.equal(k.caisses.encaisse, 240_000);
  assert.equal(k.caisses.especesEnCaisse, 240_000);

  await app.inject({ method: 'POST', url: `/admin/caisses/${caisse.id}/arreter`, headers: h, payload: { montantCompte: 240_000, verseEnBanque: 200_000 } });
  const apres = (await app.inject({ method: 'GET', url: '/admin/executive', headers: A })).json().consolidation;
  assert.equal(apres.caisses.verseEnBanque, 200_000);
  assert.equal(apres.caisses.ouvertes, 0);
  assert.equal(apres.caisses.arretesNonValides, 1, 'un arrêté non contrôlé doit se voir');
});

test('la vigilance repère une caisse jamais arrêtée et un manquant', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const h = await tresoriere(app, 'Rose Aké');
  const caisse = (await app.inject({ method: 'POST', url: '/admin/caisses', headers: h, payload: { fondDeCaisse: 0 } })).json().caisse;

  // On recule l'ouverture de deux jours : une caisse laissée ouverte d'un jour sur
  // l'autre n'est plus rattachable à une journée comptable.
  const brute = container.caisses.get(caisse.id)!;
  brute.ouverteLe = new Date(Date.now() - 48 * 3_600_000).toISOString();

  const sante = await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A });
  assert.equal(sante.statusCode, 200);
  const ids = sante.json().constats.map((c: { id: string }) => c.id);
  assert.ok(ids.includes('caisse-non-arretee'), `constats : ${ids.join(', ')}`);
});
