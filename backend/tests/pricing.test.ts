import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePrice, supplementGamme, TVA_RATE, APP_FEE_RATE } from '../src/modules/services/ride/pricing.js';

// Abidjan : Plateau → Cocody
const origin = { lat: 5.3236, lng: -4.0217 };
const destination = { lat: 5.3599, lng: -3.9876 };

test('estimation déterministe (même entrée → même prix)', () => {
  const a = estimatePrice({ origin, destination, category: 'argent' });
  const b = estimatePrice({ origin, destination, category: 'argent' });
  assert.equal(a.amount, b.amount);
  assert.ok(a.amount > 0);
});

test('devise XOF et arrondi au multiple de 50', () => {
  const r = estimatePrice({ origin, destination, category: 'argent' });
  assert.equal(r.currency, 'XOF');
  assert.equal(r.amount % 50, 0);
});

test('le prix inclut TVA 5% + frais 10% (= 15%) sur le sous-total', () => {
  const r = estimatePrice({ origin, destination, category: 'or' });
  const b = r.breakdown;
  assert.equal(b.tva, Math.round(b.subtotal * TVA_RATE));
  assert.equal(b.fee, Math.round(b.subtotal * APP_FEE_RATE));
  // total ≈ subtotal × 1.15 (avant arrondi 50)
  assert.ok(Math.abs(r.amount - b.subtotal * 1.15) <= 50);
});

test('trois gammes : Or à 100–200 F de plus que l’Argent, Diamant à 500–1 000 F de plus que l’Or', () => {
  // Trajet court (moins de 2 km) : les écarts sont à leur minimum.
  const pres = { lat: origin.lat + 0.008, lng: origin.lng };
  const prix = (dest: { lat: number; lng: number }, extra: object = {}) => {
    const de = (category: string) => estimatePrice({ origin, destination: dest, category, ...extra });
    return { argent: de('argent'), or: de('or'), diamant: de('diamant') };
  };
  const court = prix(pres);
  assert.ok(court.argent.distanceMeters < 2_000);
  assert.equal(court.or.amount - court.argent.amount, 100, 'écart Argent → Or, trajet court');
  assert.equal(court.diamant.amount - court.or.amount, 500, 'écart Or → Diamant, trajet court');
  // Trajet long (plus de 20 km) : les écarts sont à leur maximum.
  const loin = { lat: 5.2118, lng: -3.7388 };
  const long = prix(loin);
  assert.ok(long.argent.distanceMeters > 20_000);
  assert.equal(long.or.amount - long.argent.amount, 200, 'écart Argent → Or, trajet long');
  assert.equal(long.diamant.amount - long.or.amount, 1_000, 'écart Or → Diamant, trajet long');
  // Entre les deux, l'écart monte avec la distance sans jamais sortir de ses bornes, et il
  // ne dépend ni de la carrosserie ni de l'assurance.
  let precedent = { or: 0, diamant: 0 };
  for (let km = 0.5; km <= 40; km += 0.5) {
    const dest = { lat: origin.lat + km / 111.2 / 1.3, lng: origin.lng };
    const base = prix(dest);
    const or = base.or.amount - base.argent.amount, diamant = base.diamant.amount - base.or.amount;
    assert.ok(or >= 100 && or <= 200, `Argent → Or à ${km} km : ${or}`);
    assert.ok(diamant >= 500 && diamant <= 1_000, `Or → Diamant à ${km} km : ${diamant}`);
    assert.ok(or >= precedent.or && diamant >= precedent.diamant, `écarts croissants à ${km} km`);
    precedent = { or, diamant };
    for (const extra of [{ bodyType: 'suv' as const }, { insurance: true }]) {
      const p = prix(dest, extra);
      assert.equal(p.or.amount - p.argent.amount, or); assert.equal(p.diamant.amount - p.or.amount, diamant);
    }
  }
  // Barème des écarts : 100 F jusqu'à 6,5 km, 150 F ensuite, 200 F à partir de 15,5 km.
  assert.equal(supplementGamme('argent', 30), 0);
  assert.deepEqual([1, 6, 7, 15, 16, 30].map((km) => supplementGamme('or', km)), [100, 100, 150, 150, 200, 200]);
  assert.deepEqual([1, 11, 30].map((km) => supplementGamme('diamant', km) - supplementGamme('or', km)), [500, 750, 1_000]);
  // Le détail reste juste : sous-total + TVA + frais = montant payé (à l'arrondi près).
  const b = long.diamant.breakdown;
  assert.ok(Math.abs(b.subtotal + b.tva + b.fee + b.insurance - long.diamant.amount) <= 2);
});

test('la gamme Bronze n’existe plus : une demande « bronze » est servie en Argent', () => {
  const argent = estimatePrice({ origin, destination, category: 'argent' });
  const ancien = estimatePrice({ origin, destination, category: 'bronze' });
  assert.equal(ancien.category, 'argent');
  assert.equal(ancien.amount, argent.amount);
});

test('le trafic est intégré au PRIX FIXE (pas de ligne « supplément ») et majore l’ETA', () => {
  const fluid = estimatePrice({ origin, destination, category: 'argent' }, { trafficFactor: 1 });
  const jam = estimatePrice({ origin, destination, category: 'argent' }, { trafficFactor: 1.35, trafficLevel: 'jam' });
  assert.ok(jam.amount >= fluid.amount); // trafic déjà pris en compte dans le prix fixe
  assert.ok(jam.etaSeconds > fluid.etaSeconds);
  assert.equal(jam.breakdown.traffic, 0); // aucune surfacturation séparée
  assert.equal(jam.trafficLevel, 'jam');
});

test('prix fixe : le surge encadré s’applique AVANT le verrouillage du devis', () => {
  // Sans surge : multiplicateur neutre affiché dans le détail (transparence).
  const normal = estimatePrice({ origin, destination, category: 'argent' });
  assert.equal(normal.breakdown.surge, 1);
  // Avec surge (demande > offre) : le montant du devis intègre le multiplicateur —
  // le prix AFFICHÉ reste exactement le prix PAYÉ (verrouillé ensuite).
  const withSurge = estimatePrice({ origin, destination, category: 'argent' }, { surgeMultiplier: 1.3 });
  assert.equal(withSurge.breakdown.surge, 1.3);
  assert.ok(withSurge.amount > normal.amount);
});

test('un SUV coûte plus cher qu’une berline', () => {
  const berline = estimatePrice({ origin, destination, category: 'argent', bodyType: 'berline' }).amount;
  const suv = estimatePrice({ origin, destination, category: 'argent', bodyType: 'suv' }).amount;
  assert.ok(suv > berline);
});

test('les arrêts intermédiaires augmentent la distance et le prix', () => {
  const direct = estimatePrice({ origin, destination, category: 'argent' });
  const withStop = estimatePrice({ origin, destination, category: 'argent', stops: [{ lat: 5.30, lng: -4.00 }] });
  assert.ok(withStop.distanceMeters > direct.distanceMeters);
  assert.ok(withStop.amount > direct.amount);
});

test('la remise diminue le prix', () => {
  const base = estimatePrice({ origin, destination, category: 'argent' });
  const discounted = estimatePrice({ origin, destination, category: 'argent' }, { discountRate: 0.5 });
  assert.ok(discounted.amount < base.amount);
});

test('le breakdown détaille tout (transparence du prix)', () => {
  const b = estimatePrice({ origin, destination, category: 'or' }).breakdown;
  for (const k of ['base', 'distance', 'time', 'traffic', 'subtotal', 'tva', 'fee'] as const) {
    assert.ok(k in b, `breakdown.${k} manquant`);
  }
});
