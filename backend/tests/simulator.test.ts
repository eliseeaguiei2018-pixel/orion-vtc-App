import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RideSimulator } from '../src/modules/rides/simulator.js';
import { RideStore, type Ride } from '../src/modules/rides/store.js';
import { createRepository } from '../src/core/db/repository.js';
import { RealtimeHub, rideRoom } from '../src/modules/realtime/hub.js';
import type { Quote } from '../src/modules/services/types.js';

function makeRide(): Ride {
  const quote: Quote = {
    lockId: 'l', serviceType: 'ride', category: 'green', amount: 3000, currency: 'XOF',
    origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3599, lng: -3.9876 },
    distanceMeters: 5000, etaSeconds: 600, trafficLevel: 'fluid',
    breakdown: { base: 600, distance: 1500, time: 600, surge: 1, traffic: 0, discount: 0, subtotal: 2700, tva: 135, fee: 270, insurance: 0 },
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  return {
    id: 'ride-sim', clientId: 'c1', driverId: 'drv1', serviceType: 'ride', status: 'accepted',
    origin: quote.origin, destination: quote.destination, quote, events: [],
    createdAt: new Date().toISOString(),
  };
}

test('le simulateur émet des positions et atteint l’état completed', async () => {
  const rides = new RideStore(createRepository("rides"));
  const hub = new RealtimeHub();
  const ride = makeRide();
  rides.save(ride);

  const locations: unknown[] = [];
  const statuses: string[] = [];
  hub.subscribe(rideRoom(ride.id), (m) => {
    if (m.type === 'driver.location') locations.push(m.data);
    if (m.type === 'ride.status') statuses.push((m.data as { status: string }).status);
  });

  // Durées minuscules pour un test rapide.
  const sim = new RideSimulator(rides, hub, { enabled: true, tickMs: 5, enrouteMs: 30, tripMs: 30, pauseMs: 10 });
  sim.start(ride);

  await new Promise((r) => setTimeout(r, 250));
  sim.stopAll();

  assert.ok(locations.length > 0, 'des positions ont été diffusées');
  assert.ok(statuses.includes('driver_en_route'));
  assert.ok(statuses.includes('in_progress'));
  assert.equal(rides.get(ride.id)!.status, 'completed');
});

test('simulateur désactivé n’émet rien', async () => {
  const rides = new RideStore(createRepository("rides"));
  const hub = new RealtimeHub();
  const ride = makeRide();
  rides.save(ride);
  let count = 0;
  hub.subscribe(rideRoom(ride.id), () => count++);
  new RideSimulator(rides, hub, { enabled: false, tickMs: 5, enrouteMs: 10, tripMs: 10, pauseMs: 5 }).start(ride);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(count, 0);
});
