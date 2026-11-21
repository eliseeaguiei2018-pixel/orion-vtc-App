import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import {
  ouvrirAgentSos, relancerAgentSos, repondreAgentSos, type ContexteSos, type TourAgent,
} from '../src/modules/safety/agent-sos.js';

/**
 * AGENT ORION AUTOMATIQUE.
 *
 * Ce qui est vérifié ici, c'est la promesse faite à la personne en détresse : elle n'a
 * AUCUN appel à passer. L'agent lui répond tout de suite, comprend ce qui se passe, et
 * c'est le centre de contrôle qui prévient le bon service — le SAMU pour un malaise, la
 * police pour une agression, les pompiers pour un incendie — pas elle.
 */

const EN_COURSE: ContexteSos = { origine: 'bouton', enCourse: true, lieu: 'Riviera Bonoumin, Cocody' };

/** Déroule une conversation et renvoie le dernier tour, avec toutes les demandes faites. */
function converser(ctx: ContexteSos, repliques: string[]): TourAgent & { toutes: string[]; dit: string } {
  let tour = ouvrirAgentSos(ctx);
  const dit = [...tour.messages];
  for (const r of repliques) { tour = repondreAgentSos(tour.etat, r, ctx); dit.push(...tour.messages); }
  return { ...tour, toutes: tour.etat.demandes, dit: dit.join('\n') };
}

test('l’agent ouvre la conversation en citant le lieu, et propose des réponses d’un toucher', () => {
  const t = ouvrirAgentSos(EN_COURSE);
  assert.match(t.messages[0]!, /centre de contrôle ORION/);
  assert.match(t.messages[0]!, /Riviera Bonoumin/);
  assert.ok(t.suggestions.includes('Je ne peux pas parler'));
  assert.deepEqual(t.demandes, [], 'aucun service n’est dérangé avant de savoir ce qui se passe');
});

test('malaise : le centre prévient le SAMU, pas la police ; la personne n’appelle personne', () => {
  const t = converser(EN_COURSE, ['mon mari a fait un malaise dans la voiture', 'Non, elle ne répond plus']);
  assert.ok(t.toutes.includes('samu'));
  assert.ok(!t.toutes.includes('police'));
  assert.ok(t.toutes.includes('centre:rappel'), 'un agent rappelle pour guider les premiers gestes');
  assert.equal(t.etat.gravite, 'vitale');
  assert.match(t.dit, /Vous n’avez aucun appel à passer/);
  assert.match(t.dit, /Allongez-la sur le côté/);
  assert.match(t.resume, /Urgence médicale · personne inconsciente/);
});

test('accident : police d’office, SAMU seulement s’il y a des blessés, pompiers si quelqu’un est coincé', () => {
  const sans = converser(EN_COURSE, ['Accident', 'Non, personne n’est blessé', 'Non']);
  assert.deepEqual(sans.toutes, ['police', 'depannage']);

  const avec = converser(EN_COURSE, ['on a eu un accident', 'Oui, il y a des blessés', 'Oui']);
  assert.deepEqual(avec.toutes, ['police', 'samu', 'pompiers']);
});

test('agression : police aussitôt, mode discret si l’agresseur est encore là, arme signalée au centre', () => {
  const t = converser(EN_COURSE, ['on vient de me braquer au feu rouge', 'Oui, il est encore là', 'Oui']);
  assert.ok(t.toutes.includes('police'));
  assert.ok(!t.toutes.includes('pompiers'), '« feu rouge » n’est pas un incendie');
  assert.equal(t.etat.discret, true);
  assert.equal(t.etat.gravite, 'vitale');
  assert.match(t.resume, /arme signalée/);
  assert.match(t.dit, /Ne résistez pas/);
});

test('chauffeur dangereux : le centre l’appelle ; s’il refuse de s’arrêter, la police est prévenue', () => {
  const vite = converser(EN_COURSE, ['il roule trop vite et il a grillé le feu rouge']);
  assert.deepEqual(vite.toutes, ['centre:chauffeur']);

  const retenu = converser(EN_COURSE, ['Le chauffeur m’inquiète', 'Il refuse de s’arrêter', 'Oui, arrêtez la course']);
  assert.deepEqual(retenu.toutes, ['centre:chauffeur', 'police', 'centre:arret']);
});

test('incendie : pompiers, et consigne de sortir du véhicule', () => {
  const t = converser(EN_COURSE, ['la voiture fume, il y a du feu']);
  assert.deepEqual(t.toutes, ['pompiers']);
  assert.match(t.dit, /Sortez du véhicule/);
});

test('panne : dépannage et véhicule de remplacement, aucun service de secours dérangé', () => {
  const t = converser(EN_COURSE, ['on a crevé un pneu', 'Oui, je suis à l’abri', 'Oui']);
  assert.deepEqual(t.toutes, ['depannage', 'centre:remplacement']);
});

test('ne peut pas parler : mode discret et levée de doute par la police, sans attendre', () => {
  const t = converser(EN_COURSE, ['Je ne peux pas parler']);
  assert.equal(t.etat.discret, true);
  assert.ok(t.toutes.includes('police'));
  assert.ok(t.suggestions.length > 0, 'des réponses d’un toucher sont proposées');
});

test('fausse manœuvre : confirmation demandée, puis clôture — sauf si la personne peut être sous contrainte', () => {
  const simple = converser({ ...EN_COURSE, enCourse: false }, ['Fausse manœuvre, tout va bien', 'Oui, tout va bien']);
  assert.equal(simple.terminer, true);
  assert.deepEqual(simple.toutes, []);

  // Après une agression signalée, « tout va bien » ne suffit pas : un humain confirme.
  const contrainte = converser(EN_COURSE, ['il me menace avec un couteau', 'tout va bien', 'Oui, tout va bien']);
  assert.equal(contrainte.terminer, false);
  assert.ok(contrainte.toutes.includes('centre:rappel'));
});

test('message incompris : l’agent ne tourne pas en rond, il fait rappeler la personne', () => {
  const t = converser(EN_COURSE, ['bjr', 'aidez moi svp']);
  assert.ok(t.toutes.includes('centre:rappel'));
});

test('une question restée sans réponse est reposée une fois, pas dix', () => {
  const t1 = converser(EN_COURSE, ['il roule trop vite', 'je suis vers le carrefour de la vie']);
  assert.match(t1.messages.at(-1)!, /arrêtée au prochain endroit sûr/);
  const t2 = repondreAgentSos(t1.etat, 'devant la pharmacie', EN_COURSE);
  assert.doesNotMatch(t2.messages.join(' '), /arrêtée au prochain endroit sûr/);
});

test('choc détecté par les capteurs : SAMU et police prévenus avant toute réponse', () => {
  const t = ouvrirAgentSos({ origine: 'choc', enCourse: true });
  assert.deepEqual(t.demandes.map((d) => d.cle), ['samu', 'police']);
  assert.match(t.messages[0]!, /choc violent/);
});

test('silence : relance à 30 s, puis rappel et police par précaution à 75 s', () => {
  const debut = ouvrirAgentSos(EN_COURSE);
  assert.equal(relancerAgentSos(debut.etat, EN_COURSE, 10), null);
  const r1 = relancerAgentSos(debut.etat, EN_COURSE, 31)!;
  assert.match(r1.messages[0]!, /toujours là/);
  assert.equal(relancerAgentSos(r1.etat, EN_COURSE, 40), null, 'pas de seconde relance avant 75 s');
  const r2 = relancerAgentSos(r1.etat, EN_COURSE, 76)!;
  assert.deepEqual(r2.demandes.map((d) => d.cle), ['centre:rappel', 'police']);
  assert.equal(relancerAgentSos(r2.etat, EN_COURSE, 300), null, 'ensuite, l’agent n’insiste plus');
});

test('l’agent répond en anglais à une application en anglais', () => {
  const ctx: ContexteSos = { origine: 'bouton', enCourse: true, langue: 'en' };
  const t = converser(ctx, ['there was a car crash', 'Yes, someone is hurt']);
  assert.deepEqual(t.toutes, ['police', 'samu']);
  assert.match(t.dit, /You have no call to make/);
});

test('les deux copies de l’agent (serveur et application) sont identiques', () => {
  const serveur = readFileSync(fileURLToPath(new URL('../src/modules/safety/agent-sos.ts', import.meta.url)), 'utf8');
  const application = readFileSync(fileURLToPath(new URL('../../frontend/src/agentSos.ts', import.meta.url)), 'utf8');
  assert.equal(application, serveur, 'recopier backend/src/modules/safety/agent-sos.ts vers frontend/src/agentSos.ts');
});

/* --------------------------- De bout en bout, sur le serveur --------------------------- */

const JETON = { 'x-admin-token': 'orion-admin-dev' };

test('serveur : le SOS ouvre la conversation, la réponse du client crée la demande au centre', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: 'POST', url: '/safety/sos', payload: { userId: 'cliente-1', location: { lat: 5.3599, lng: -3.9876 } } });
  assert.equal(res.statusCode, 201);
  const { alert, suivi } = res.json();
  assert.equal(suivi.agentAuto, true);
  assert.equal(suivi.chat.length, 1);
  assert.equal(suivi.chat[0].author, 'Agent ORION');
  assert.ok(suivi.suggestions.length > 0);
  assert.deepEqual(suivi.demandes, []);

  // La cliente écrit : l'agent répond dans la même requête, et demande le SAMU au centre.
  const rep = await app.inject({ method: 'POST', url: `/safety/sos/${alert.id}/message`, payload: { userId: 'cliente-1', text: 'ma mère fait un malaise' } });
  const s = rep.json().suivi;
  assert.equal(s.demandes.length, 1);
  assert.deepEqual({ cle: s.demandes[0].cle, numero: s.demandes[0].numero, statut: s.demandes[0].statut }, { cle: 'samu', numero: '185', statut: 'transmise' });
  assert.equal(s.chat.at(-1).from, 'agent');
  assert.equal(JSON.stringify(s).includes('Urgence médicale'), false, 'la raison donnée à l’opérateur reste interne');

  // La console lit la synthèse et la demande, avec sa raison.
  const dossier = (await app.inject({ method: 'GET', url: `/admin/sos/${alert.id}`, headers: JETON })).json().alert;
  assert.match(dossier.resume, /Urgence médicale/);
  assert.equal(dossier.demandes[0].raison, 'Urgence médicale');

  // L'opérateur compose le 185 : la cliente voit « en cours », puis « joint ».
  const appel = await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/contact`, headers: JETON, payload: { canal: 'appel', contactId: 'samu' } });
  const voir = async () => (await app.inject({ method: 'GET', url: `/safety/sos/${alert.id}?userId=cliente-1` })).json().suivi;
  assert.equal((await voir()).demandes[0].statut, 'en_cours');
  await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/contact/${appel.json().entry.id}`, headers: JETON, payload: { issue: 'joint' } });
  assert.equal((await voir()).demandes[0].statut, 'joint');
});

test('serveur : une demande interne (appeler le chauffeur) est cochée par l’opérateur', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { alert } = (await app.inject({ method: 'POST', url: '/safety/sos', payload: { userId: 'client-2', location: { lat: 5.32, lng: -4.02 }, rideId: 'course-x' } })).json();
  await app.inject({ method: 'POST', url: `/safety/sos/${alert.id}/message`, payload: { userId: 'client-2', text: 'il roule trop vite' } });

  const fait = await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/demandes/centre:chauffeur/traiter`, headers: JETON });
  assert.equal(fait.statusCode, 200, fait.body);
  const s = (await app.inject({ method: 'GET', url: `/safety/sos/${alert.id}?userId=client-2` })).json().suivi;
  assert.equal(s.demandes.find((d: { cle: string }) => d.cle === 'centre:chauffeur').statut, 'faite');
  // Deux fois : refusé, la demande est déjà traitée.
  assert.equal((await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/demandes/centre:chauffeur/traiter`, headers: JETON })).statusCode, 404);
});

test('serveur : fausse manœuvre confirmée, l’alerte se referme sans opérateur', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { alert } = (await app.inject({ method: 'POST', url: '/safety/sos', payload: { userId: 'client-3', location: { lat: 5.32, lng: -4.02 } } })).json();
  const dire = (text: string) => app.inject({ method: 'POST', url: `/safety/sos/${alert.id}/message`, payload: { userId: 'client-3', text } });
  await dire('Fausse manœuvre, tout va bien');
  const s = (await dire('Oui, tout va bien')).json().suivi;
  assert.equal(s.status, 'cancelled');
  assert.ok(s.clotureeA);
  assert.equal(s.agentAuto, false);
});

test('serveur : le canal de la course ne transporte rien de la conversation SOS', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const recus: Array<{ type: string; data: unknown }> = [];
  container.realtime.subscribe('ride:course-y', (m) => recus.push(m as { type: string; data: unknown }));

  const { alert } = (await app.inject({ method: 'POST', url: '/safety/sos', payload: { userId: 'cliente-4', location: { lat: 5.32, lng: -4.02 }, rideId: 'course-y' } })).json();
  await app.inject({ method: 'POST', url: `/safety/sos/${alert.id}/message`, payload: { userId: 'cliente-4', text: 'le chauffeur refuse de s’arrêter' } });

  // L'app du chauffeur écoute ce canal : elle ne doit y lire ni message, ni motif, ni position.
  const brut = JSON.stringify(recus);
  assert.equal(brut.includes('refuse'), false);
  assert.equal(brut.includes('police'), false);
  assert.equal(brut.includes('"location"'), false);
  assert.ok(recus.every((m) => m.type === 'emergency.alert'), `types reçus : ${recus.map((m) => m.type).join(', ')}`);
});

test('contrôle de sécurité en course : « je ne me sens pas en sécurité » ouvre la conversation avec le centre', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  // C'est ce que fait la messagerie quand le client répond « danger » au contrôle.
  const alerte = container.safety.raiseSos({
    userId: 'client-5', rideId: 'course-z', location: { lat: 5.32, lng: -4.02 }, origine: 'controle',
  });
  const suivi = container.safety.suiviPour(alerte.id, 'client-5');
  assert.ok(suivi !== undefined && suivi !== 'interdit');
  assert.match(suivi.chat[0]!.text, /ne pas vous sentir en sécurité/);
  assert.ok(suivi.suggestions.includes('Il roule trop vite'));

  // Un chauffeur en détresse, lui, est pris directement par un opérateur.
  const chauffeur = container.safety.raiseSos({ userId: 'driver-1', location: { lat: 5.32, lng: -4.02 }, source: 'chauffeur' });
  assert.equal(chauffeur.chat?.length, 0);
  assert.equal(chauffeur.agentAuto, undefined);
});
