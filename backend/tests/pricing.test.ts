import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePrice, TVA_RATE, APP_FEE_RATE } from '../src/modules/services/ride/pricing.js';

// Abidjan : Plateau → Cocody
const origin = { lat: 5.3236, lng: -4.0217 };
const destination = { lat: 5.3599, lng: -3.9876 };

test('estimation déterministe (même entrée → même prix)', () => {
  const a = estimatePrice({ origin, destination, category: 'bronze' });
  const b = estimatePrice({ origin, destination, category: 'bronze' });
  assert.equal(a.amount, b.amount);
  assert.ok(a.amount > 0);
});

test('devise XOF et arrondi au multiple de 50', () => {
  const r = estimatePrice({ origin, destination, category: 'bronze' });
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

test('les niveaux sont croissants : bronze < argent < or < diamant', () => {
  const bronze = estimatePrice({ origin, destination, category: 'bronze' }).amount;
  const argent = estimatePrice({ origin, destination, category: 'argent' }).amount;
  const or = estimatePrice({ origin, destination, category: 'or' }).amount;
  const diamant = estimatePrice({ origin, destination, category: 'diamant' }).amount;
  assert.ok(bronze < argent && argent < or && or < diamant);
});

test('le trafic (embouteillage) majore le prix et l’ETA', () => {
  const fluid = estimatePrice({ origin, destination, category: 'bronze' }, { trafficFactor: 1 });
  const jam = estimatePrice({ origin, destination, category: 'bronze' }, { trafficFactor: 1.35, trafficLevel: 'jam' });
  assert.ok(jam.amount > fluid.amount);
  assert.ok(jam.etaSeconds > fluid.etaSeconds);
  assert.ok(jam.breakdown.traffic > 0);
  assert.equal(jam.trafficLevel, 'jam');
});

test('un SUV coûte plus cher qu’une berline', () => {
  const berline = estimatePrice({ origin, destination, category: 'argent', bodyType: 'berline' }).amount;
  const suv = estimatePrice({ origin, destination, category: 'argent', bodyType: 'suv' }).amount;
  assert.ok(suv > berline);
});

test('les arrêts intermédiaires augmentent la distance et le prix', () => {
  const direct = estimatePrice({ origin, destination, category: 'bronze' });
  const withStop = estimatePrice({ origin, destination, category: 'bronze', stops: [{ lat: 5.30, lng: -4.00 }] });
  assert.ok(withStop.distanceMeters > direct.distanceMeters);
  assert.ok(withStop.amount > direct.amount);
});

test('la remise diminue le prix', () => {
  const base = estimatePrice({ origin, destination, category: 'bronze' });
  const discounted = estimatePrice({ origin, destination, category: 'bronze' }, { discountRate: 0.5 });
  assert.ok(discounted.amount < base.amount);
});

test('le breakdown détaille tout (transparence du prix)', () => {
  const b = estimatePrice({ origin, destination, category: 'or' }).breakdown;
  for (const k of ['base', 'distance', 'time', 'traffic', 'subtotal', 'tva', 'fee'] as const) {
    assert.ok(k in b, `breakdown.${k} manquant`);
  }
});
