import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeHub, EMERGENCY_ROOM } from '../src/modules/realtime/hub.js';
import { SafetyService, isLikelyCrash, impactMagnitudeG } from '../src/modules/safety/service.js';

const abidjan = { lat: 5.3236, lng: -4.0217 };

test('impact au repos ≈ 0 g (gravité retirée)', () => {
  assert.ok(impactMagnitudeG({ ax: 0, ay: 0, az: 1 }) < 0.1);
});

test('choc violent détecté', () => {
  assert.equal(isLikelyCrash({ ax: 6, ay: 4, az: 2 }), true);
});

test('chute de téléphone à l’arrêt non détectée comme accident', () => {
  // ~4.2 g mais véhicule à l'arrêt → pas d'accident de la route
  assert.equal(isLikelyCrash({ ax: 4.2, ay: 0, az: 1, speedKmh: 0 }), false);
});

test('choc modéré en mouvement détecté', () => {
  // magnitude ≈ 5.1 g, net ≈ 4.1 g (> seuil) + véhicule en mouvement
  assert.equal(isLikelyCrash({ ax: 5, ay: 0, az: 1, speedKmh: 40 }), true);
});

test('SOS reçu par la supervision — mais aucun secours n’est déclaré prévenu tant que personne n’a appelé', () => {
  const hub = new RealtimeHub();
  let received: unknown = null;
  hub.subscribe(EMERGENCY_ROOM, (m) => (received = m));
  const safety = new SafetyService(hub);

  const alert = safety.raiseSos({ userId: 'u1', location: abidjan, rideId: 'r1' });
  assert.equal(alert.kind, 'sos');
  // Avant : « dispatched » vers 185 et 170 dès la création, alors qu'aucun numéro
  // n'avait été composé — le dossier et l'usager croyaient le SAMU en route.
  assert.equal(alert.status, 'raised');
  assert.deepEqual(alert.dispatchedTo, []);
  assert.ok(alert.zoneName); // rattaché à une zone (Plateau)
  assert.ok(received, 'le poste de supervision a reçu l’alerte');
});

test('capteur sans choc ne crée pas d’alerte', () => {
  const safety = new SafetyService(new RealtimeHub());
  const r = safety.ingestSensor({ userId: 'u1', location: abidjan, sample: { ax: 0, ay: 0, az: 1 } });
  assert.equal(r, null);
});

test('capteur avec crash crée une alerte automatique', () => {
  const safety = new SafetyService(new RealtimeHub());
  const r = safety.ingestSensor({ userId: 'u1', location: abidjan, sample: { ax: 7, ay: 5, az: 3, speedKmh: 50 } });
  assert.ok(r);
  assert.equal(r!.kind, 'crash');
  assert.ok((r!.impactG ?? 0) > 4);
});
