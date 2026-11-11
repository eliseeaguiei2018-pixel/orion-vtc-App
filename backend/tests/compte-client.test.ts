import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * COMPTE CLIENT, PHOTO, ANNULATIONS MOTIVÉES, HISTORIQUE.
 *
 * Avant : n'importe quel code à 4 chiffres ouvrait l'app, le profil se modifiait
 * avec le seul identifiant de l'appareil, et une annulation ne disait ni qui, ni
 * pourquoi, ni combien — les frais étaient enregistrés sans que le client le sache.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };
type App = Awaited<ReturnType<typeof buildApp>>['app'];
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString('base64')}`;

async function inscrire(app: App, clientId: string, phone: string, name?: string) {
  const otp = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone } });
  assert.equal(otp.statusCode, 200, otp.body);
  const v = await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId, phone, code: otp.json().devCode, name } });
  assert.equal(v.statusCode, 200, v.body);
  return v.json() as { token: string; compteRetrouve: boolean; client: { id: string; name: string; phone: string } };
}

test('inscription : le numéro est vérifié pour de vrai, et un numéro = un compte', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const otp = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '07 12 34 56 78' } });
  const faux = await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: 'client-a', phone: '0712345678', code: '000000', name: 'Aya Kouassi' } });
  assert.equal(faux.statusCode, 401, 'un code inventé ne doit plus ouvrir un compte');
  const ok = await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: 'client-a', phone: '0712345678', code: otp.json().devCode, name: 'Aya Kouassi' } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().client.phone, '+2250712345678');
  assert.equal(ok.json().compteRetrouve, false);

  // Nouveau téléphone, même numéro : elle retrouve SON compte.
  const retour = await inscrire(app, 'client-autre-appareil', '+225 07 12 34 56 78');
  assert.equal(retour.compteRetrouve, true);
  assert.equal(retour.client.id, 'client-a');
});

test('profil et photo : réservés au titulaire, photo vérifiée octet par octet', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const aya = await inscrire(app, 'client-aya', '0711111111', 'Aya Kouassi');
  const ben = await inscrire(app, 'client-ben', '0722222222', 'Ben Koffi');
  const H = { authorization: `Bearer ${aya.token}` };

  assert.equal((await app.inject({ method: 'PUT', url: '/clients/client-aya/photo', payload: { photo: JPEG } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'PUT', url: '/clients/client-aya/photo', headers: { authorization: `Bearer ${ben.token}` }, payload: { photo: JPEG } })).statusCode, 403);

  const deguisee = `data:image/jpeg;base64,${Buffer.from('<script>alert(1)</script> ceci n’est pas une image').toString('base64')}`;
  assert.equal((await app.inject({ method: 'PUT', url: '/clients/client-aya/photo', headers: H, payload: { photo: deguisee } })).statusCode, 400);

  const ok = await app.inject({ method: 'PUT', url: '/clients/client-aya/photo', headers: H, payload: { photo: JPEG } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().client.photo, JPEG);

  const maj = await app.inject({ method: 'PUT', url: '/clients/client-aya/profile', headers: H, payload: { name: 'Aya K. Kouassi', email: 'aya@example.ci' } });
  assert.equal(maj.json().client.email, 'aya@example.ci');

  // La console voit la photo dans la fiche… mais pas dans la liste.
  const fiche = await app.inject({ method: 'GET', url: '/admin/clients/client-aya', headers: A });
  assert.equal(fiche.json().client.photo, JPEG);
  const liste = (await app.inject({ method: 'GET', url: '/admin/clients?limit=100', headers: A })).json().clients;
  const ligne = liste.find((c: { id: string }) => c.id === 'client-aya');
  assert.equal(ligne.photo, undefined);
  assert.equal(ligne.hasPhoto, true);

  // Et dans un dossier SOS, pour reconnaître la passagère.
  const sos = (await app.inject({ method: 'POST', url: '/safety/sos', payload: { userId: 'client-aya', location: { lat: 5.32, lng: -4.02 } } })).json();
  const dossier = await app.inject({ method: 'GET', url: `/admin/sos/${sos.alert.id}`, headers: A });
  assert.equal(dossier.json().passenger.photo, JPEG);

  assert.equal((await app.inject({ method: 'DELETE', url: '/clients/client-aya/photo', headers: H })).json().client.photo, null);
});

async function courseAvecChauffeur(app: App, container: Awaited<ReturnType<typeof buildApp>>['container'], clientId: string, suffixe: string) {
  const d = container.drivers.upsert({ id: `drv-an-${suffixe}`, name: 'Konan Yao', matricule: `AN-${suffixe}`, category: 'bronze', kycStatus: 'active', availability: 'offline', ratingAvg: 4.8, ratingCount: 10, phone: '+2250701020304' });
  await container.drivers.goOnline(d.id, { lat: 5.3236, lng: -4.0217 });
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3596, lng: -3.9903 }, category: 'bronze', clientId } });
  const ride = (await app.inject({ method: 'POST', url: '/rides', payload: { clientId, lockId: est.json().quote.lockId } })).json().ride;
  assert.equal(ride.driverId, d.id);
  return { ride, driverId: d.id };
}

test('annulation : les frais sont annoncés avant, le motif et l’auteur sont enregistrés', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const aya = await inscrire(app, 'client-an', '0733333333', 'Aya Kouassi');

  // Dans le délai de grâce : gratuit.
  const { ride, driverId } = await courseAvecChauffeur(app, container, 'client-an', '1');
  const apercu = await app.inject({ method: 'GET', url: `/rides/${ride.id}/cancel-preview?clientId=client-an&motif=changement_plan` });
  assert.equal(apercu.json().frais.montant, 0);
  assert.equal(apercu.json().frais.raisonGratuite, 'delai_de_grace');

  // Au-delà : les frais s'appliquent — sauf motif de sécurité.
  container.rides.get(ride.id)!.createdAt = new Date(Date.now() - 10 * 60_000).toISOString();
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${ride.id}/cancel-preview?clientId=client-an&motif=changement_plan` })).json().frais.montant, 500);
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${ride.id}/cancel-preview?clientId=client-an&motif=securite` })).json().frais.montant, 0);

  // Personne d'autre ne peut annuler la course d'Aya.
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${ride.id}/cancel`, payload: { clientId: 'client-intrus', motif: 'autre' } })).statusCode, 404);

  const r = await app.inject({ method: 'POST', url: `/rides/${ride.id}/cancel`, payload: { clientId: 'client-an', motif: 'attente_longue', details: 'Le chauffeur ne bougeait plus depuis 8 minutes' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().frais.montant, 500);
  assert.equal(container.drivers.get(driverId)!.availability, 'online', 'le chauffeur est libéré');

  // L'historique dit tout : qui, pourquoi, combien.
  const h = await app.inject({ method: 'GET', url: '/clients/client-an/history', headers: { authorization: `Bearer ${aya.token}` } });
  assert.equal(h.statusCode, 200, h.body);
  const c = h.json().courses[0];
  assert.deepEqual({ par: c.annulation.par, motif: c.annulation.motif, frais: c.annulation.frais }, { par: 'client', motif: 'attente_longue', frais: 500 });
  assert.equal(c.chauffeur.name, 'Konan Yao');
  assert.equal(h.json().resume.annulees, 1);
  assert.equal(h.json().resume.fraisAnnulation, 500);

  // La console voit le motif dans la fiche client.
  const fiche = (await app.inject({ method: 'GET', url: '/admin/clients/client-an', headers: A })).json().client;
  assert.equal(fiche.recentRides[0].annulation.motif, 'attente_longue');

  // Le profil compte les courses EFFECTUÉES : une course annulée n'en est pas une.
  const prof = (await app.inject({ method: 'GET', url: '/clients/client-an/profile', headers: { authorization: `Bearer ${aya.token}` } })).json().client;
  assert.equal(prof.stats.courses, 0);
  assert.equal(prof.stats.commandes, 1);
  assert.equal(prof.stats.annulations, 1);

  // L'historique d'un client n'est lisible qu'avec sa session.
  assert.equal((await app.inject({ method: 'GET', url: '/clients/client-an/history' })).statusCode, 401);
});

test('suppression du compte : identité effacée, courses conservées ; un compte suspendu ne se reconnecte pas', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const aya = await inscrire(app, 'client-del', '0744444444', 'Aya Kouassi');
  const H = { authorization: `Bearer ${aya.token}` };
  await app.inject({ method: 'PUT', url: '/clients/client-del/photo', headers: H, payload: { photo: JPEG } });
  assert.equal((await app.inject({ method: 'DELETE', url: '/clients/client-del', headers: H })).statusCode, 200);
  const c = container.clients.get('client-del')!;
  assert.equal(c.name, undefined); assert.equal(c.phone, undefined); assert.equal(c.photo, undefined);
  assert.ok(c.deletedAt);

  // Compte suspendu par le support : la connexion est refusée.
  const ben = await inscrire(app, 'client-blq', '0755555555', 'Ben Koffi');
  assert.ok(ben.token);
  container.clients.setStatus('client-blq', 'blocked');
  const otp = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0755555555' } });
  const v = await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: 'client-x', phone: '0755555555', code: otp.json().devCode } });
  assert.equal(v.statusCode, 403);
});

test('appareil partagé : une nouvelle inscription n’écrase jamais le compte précédent', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  await inscrire(app, 'client-tel-partage', '0766666666', 'Aya Kouassi');
  // Une autre personne s'inscrit sur le même téléphone, avec son propre numéro.
  const ben = await inscrire(app, 'client-tel-partage', '0777777777', 'Ben Koffi');
  assert.notEqual(ben.client.id, 'client-tel-partage');
  assert.equal(container.clients.get('client-tel-partage')!.name, 'Aya Kouassi', 'le compte d’Aya est intact');
  assert.equal(container.clients.get(ben.client.id)!.name, 'Ben Koffi');
});
