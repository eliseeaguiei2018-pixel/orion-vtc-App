import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { AdminService } from '../src/modules/admin/service.js';
import type { Ride } from '../src/modules/rides/store.js';

/**
 * DÉVIATION D'ITINÉRAIRE : une alerte SAMU « orange » ne doit partir que pour un vrai
 * détour pendant le trajet avec le client. L'approche du chauffeur et le tracé routier
 * normal (ponts, échangeurs) ne sont pas des déviations : c'était le cas, et chaque
 * course simulée déclenchait une alerte.
 */
const ORIGINE = { lat: 5.3236, lng: -4.0217 };      // Plateau
const DEST = { lat: 5.3599, lng: -3.9876 };         // Cocody Riviera
const ligne = (a: { lat: number; lng: number }, b: { lat: number; lng: number }, n: number) =>
  Array.from({ length: n + 1 }, (_, i) => ({ lat: a.lat + ((b.lat - a.lat) * i) / n, lng: a.lng + ((b.lng - a.lng) * i) / n }));

const course = (extra: Partial<Ride>): Ride => ({
  id: 'r-dev', clientId: 'c-dev', driverId: 'd-dev', serviceType: 'ride', status: 'in_progress',
  origin: ORIGINE, destination: DEST, quote: { amount: 2000 } as Ride['quote'], events: [], createdAt: new Date().toISOString(), ...extra,
});

test('déviation : l’approche du chauffeur ne compte pas, un vrai détour oui', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const admin = new AdminService(container);

  // Longue approche (6 km), puis trajet direct : pas de déviation.
  const loin = { lat: 5.27, lng: -4.06 };
  const approche = [...ligne(loin, { lat: 5.36, lng: -4.06 }, 10), ...ligne({ lat: 5.36, lng: -4.06 }, ORIGINE, 10)];
  const trajet = ligne(ORIGINE, DEST, 12);
  assert.equal(admin.rideAnomaly(course({ trace: [...approche, ...trajet], traceDepart: approche.length })), null);

  // Tracé routier un peu plus long que prévu (ponts) : pas de déviation non plus.
  const itineraire = { geometrie: trajet, distanceMeters: 6200, durationSeconds: 900, ponts: [], provider: 'osrm' };
  assert.equal(admin.rideAnomaly(course({ trace: trajet, traceDepart: 0, itineraire })), null);

  // Vrai détour pendant la course : vers Yopougon et retour, trois fois la distance prévue.
  const yopougon = { lat: 5.345, lng: -4.09 };
  const detour = [...ligne(ORIGINE, yopougon, 8), ...ligne(yopougon, { lat: 5.25, lng: -4.0 }, 8), ...ligne({ lat: 5.25, lng: -4.0 }, DEST, 8)];
  assert.equal(admin.rideAnomaly(course({ trace: detour, traceDepart: 0, itineraire })), 'detour');
});
