import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { EMERGENCY_ROOM } from '../src/modules/realtime/hub.js';

/** L'usager peut mettre fin à SON alerte SOS et à la discussion avec l'agent ORION. */
test('SOS : l’usager met fin à son alerte (en sécurité), la console le voit, personne d’autre ne peut', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const avis: string[] = [];
  container.realtime.subscribeAll((m) => { if (m.room === EMERGENCY_ROOM) avis.push(m.type); });

  const sos = await app.inject({ method: 'POST', url: '/safety/sos', payload: { userId: 'client-sos-fin', location: { lat: 5.36, lng: -3.99 } } });
  assert.equal(sos.statusCode, 201);
  const id = sos.json().alert.id as string;

  // Quelqu'un d'autre ne peut pas clore l'alerte (ni apprendre qu'elle existe).
  const autre = await app.inject({ method: 'POST', url: `/safety/sos/${id}/terminer`, payload: { userId: 'quelqu-un-d-autre', motif: 'fausse_alerte' } });
  assert.equal(autre.statusCode, 404);

  const fin = await app.inject({ method: 'POST', url: `/safety/sos/${id}/terminer`, payload: { userId: 'client-sos-fin', motif: 'en_securite' } });
  assert.equal(fin.statusCode, 200, fin.body);
  const suivi = fin.json().suivi;
  assert.ok(suivi.clotureeA, 'alerte close pour l’usager');
  assert.equal(suivi.suggestions.length, 0, 'plus de réponses rapides');
  assert.match(suivi.chat.at(-1).text, /en sécurité/);

  const alerte = container.safety.get(id)!;
  assert.equal(alerte.status, 'cancelled');
  assert.equal(alerte.fermeeParUsager?.motif, 'en_securite');
  assert.equal(alerte.sealed ?? false, false, 'l’agent peut encore relire et clôturer le dossier');
  assert.ok(avis.includes('emergency.update'), 'console prévenue en direct');

  // Discussion close : un nouveau message est refusé ; refaire « terminer » reste sans effet.
  const msg = await app.inject({ method: 'POST', url: `/safety/sos/${id}/message`, payload: { userId: 'client-sos-fin', text: 'encore là ?' } });
  assert.equal(msg.statusCode, 409);
  const encore = await app.inject({ method: 'POST', url: `/safety/sos/${id}/terminer`, payload: { userId: 'client-sos-fin', motif: 'fausse_alerte' } });
  assert.equal(encore.statusCode, 200);
  assert.equal(container.safety.get(id)!.fermeeParUsager?.motif, 'en_securite');
});
