import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePrice } from '../src/modules/services/ride/pricing.js';

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

test('le prix respecte le tarif minimum du niveau', () => {
  const r = estimatePrice({ origin, destination: origin, category: 'bronze' });
  assert.equal(r.amount, 900); // minFare bronze = 1000 × 0.9
});

test('les niveaux sont croissants : bronze < argent < or < diamant', () => {
  const bronze = estimatePrice({ origin, destination, category: 'bronze' }).amount;
  const argent = estimatePrice({ origin, destination, category: 'argent' }).amount;
  const or = estimatePrice({ origin, destination, category: 'or' }).amount;
  const diamant = estimatePrice({ origin, destination, category: 'diamant' }).amount;
  assert.ok(bronze < argent && argent < or && or < diamant);
});

test('catégorie inconnue → niveau par défaut (bronze)', () => {
  const def = estimatePrice({ origin, destination }).amount;
  const bronze = estimatePrice({ origin, destination, category: 'bronze' }).amount;
  assert.equal(def, bronze);
});

test('le surge augmente le prix, la remise le diminue', () => {
  const base = estimatePrice({ origin, destination, category: 'bronze' });
  const surged = estimatePrice({ origin, destination, category: 'bronze' }, { surgeMultiplier: 2 });
  const discounted = estimatePrice({ origin, destination, category: 'bronze' }, { discountRate: 0.5 });
  assert.ok(surged.amount > base.amount);
  assert.ok(discounted.amount < base.amount);
});

test('le breakdown est fourni (transparence)', () => {
  const r = estimatePrice({ origin, destination, category: 'or' });
  assert.ok('base' in r.breakdown && 'distance' in r.breakdown && 'time' in r.breakdown);
});
