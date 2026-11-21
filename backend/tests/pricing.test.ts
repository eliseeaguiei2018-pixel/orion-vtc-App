import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePrice, TVA_RATE, APP_FEE_RATE } from '../src/modules/services/ride/pricing.js';

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

test('trois gammes : Argent, puis Or à +700 F, puis Diamant à +1 000 F de plus', () => {
  const argent = estimatePrice({ origin, destination, category: 'argent' });
  const or = estimatePrice({ origin, destination, category: 'or' });
  const diamant = estimatePrice({ origin, destination, category: 'diamant' });
  assert.equal(or.amount - argent.amount, 700, 'écart Argent → Or');
  assert.equal(diamant.amount - or.amount, 1_000, 'écart Or → Diamant');
  // L'écart est fixe : il ne dépend ni de la distance, ni de la carrosserie, ni de l'assurance.
  const loin = { lat: 5.2539, lng: -3.9263 };
  for (const extra of [{}, { bodyType: 'suv' as const }, { insurance: true }]) {
    const a = estimatePrice({ origin, destination: loin, category: 'argent', ...extra }).amount;
    const o = estimatePrice({ origin, destination: loin, category: 'or', ...extra }).amount;
    const d = estimatePrice({ origin, destination: loin, category: 'diamant', ...extra }).amount;
    assert.equal(o - a, 700); assert.equal(d - o, 1_000);
  }
  // Le détail reste juste : sous-total + TVA + frais = montant payé (à l'arrondi près).
  const b = diamant.breakdown;
  assert.ok(Math.abs(b.subtotal + b.tva + b.fee + b.insurance - diamant.amount) <= 2);
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
