import { buildApp } from '../src/app.js';
import type { Ride } from '../src/modules/rides/store.js';
import type { Quote } from '../src/modules/services/types.js';

/**
 * Stress-test de la console : seed massif (400 chauffeurs, 6 000 courses) puis
 * mesure de latence des endpoints admin les plus sollicités.
 *
 *   npx tsx scripts/stress.ts
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };

async function main() {
  const { app, container } = await buildApp();

  // --- Seed : 400 chauffeurs en ligne autour d'Abidjan ---
  const t0 = Date.now();
  for (let i = 0; i < 400; i++) {
    const id = `drv-${i}`;
    container.drivers.upsert({
      id, name: `Chauffeur ${i}`, matricule: `ORION-CI-${1000 + i}`,
      kycStatus: 'active', availability: 'online', category: (['bronze', 'argent', 'or', 'diamant'] as const)[i % 4]!,
      ratingAvg: 4 + (i % 10) / 10, ratingCount: 50 + i, idleSince: new Date(Date.now() - i * 1000).toISOString(),
    });
    await container.geo.upsert({ id, lat: 5.30 + (i % 40) * 0.004, lng: -4.05 + Math.floor(i / 40) * 0.006, meta: { category: 'bronze' } });
  }

  // --- Seed : 6 000 courses réparties sur 30 jours ---
  const statuses = ['rated', 'paid', 'completed', 'cancelled', 'in_progress'] as const;
  for (let i = 0; i < 6000; i++) {
    const day = i % 30;
    const quote = {
      lockId: `l${i}`, serviceType: 'course', category: 'bronze',
      origin: { lat: 5.32, lng: -4.02 }, destination: { lat: 5.36, lng: -3.99 },
      amount: 1000 + (i % 90) * 50, currency: 'XOF', distanceMeters: 5000, etaSeconds: 900,
      trafficLevel: 'dense', breakdown: { base: 300, distance: 650, time: 200, surge: 1, traffic: 0, discount: 0, subtotal: 1150, tva: 58, fee: 115, insurance: 0 },
    } as unknown as Quote;
    const ride: Ride = {
      id: `ride-${i}`, clientId: `client-${i % 800}`, driverId: `drv-${i % 400}`,
      serviceType: 'course', status: statuses[i % statuses.length]!,
      origin: quote.origin, destination: quote.destination, quote,
      events: [], createdAt: new Date(Date.now() - day * 86_400_000 - (i % 1440) * 60_000).toISOString(),
    };
    container.rides.save(ride);
  }
  // eslint-disable-next-line no-console
  console.log(`Seed : 400 chauffeurs + 6000 courses en ${Date.now() - t0} ms\n`);

  // --- Mesures (moyenne sur 5 appels) ---
  const endpoints = [
    ['GET', '/admin/overview'],
    ['GET', '/admin/rides?page=3&limit=25'],
    ['GET', '/admin/drivers?page=2&limit=25'],
    ['GET', '/admin/stats?days=30'],
    ['GET', '/admin/search?q=chauffeur 25'],
    ['GET', '/admin/fleet/live'],
    ['GET', '/admin/rides.csv'],
  ] as const;

  for (const [method, url] of endpoints) {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const s = performance.now();
      const res = await app.inject({ method, url, headers: AUTH });
      times.push(performance.now() - s);
      if (res.statusCode !== 200) throw new Error(`${url} → ${res.statusCode}`);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    // eslint-disable-next-line no-console
    console.log(`${url.padEnd(34)} moy ${avg.toFixed(1)} ms  (max ${Math.max(...times).toFixed(1)} ms)`);
  }

  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
