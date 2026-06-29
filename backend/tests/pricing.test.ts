import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePrice } from '../src/modules/services/ride/pricing.js';

// Abidjan : Plateau → Cocody
const origin = { lat: 5.3236, lng: -4.0217 };
const destination = { lat: 5.3599, lng: -3.9876 };

test('estimation déterministe (même entrée → même prix)', () => {
  const a = estimatePrice({ origin, destination, category: 'green' });
  const b = estimatePrice({ origin, destination, category: 'green' });
  assert.equal(a.amount, b.amount);
  assert.ok(a.amount > 0);
});

test('devise XOF et arrondi au multiple de 50', () => {
  const r = estimatePrice({ origin, destination, category: 'green' });
  assert.equal(r.currency, 'XOF');
  assert.equal(r.amount % 50, 0);
});

test('le prix respecte le tarif minimum', () => {
  const r = estimatePrice({ origin, destination: origin, category: 'green' });
  assert.equal(r.amount, 1200); // minFare green (FCFA)
});

test('le surge augmente le prix, la remise le diminue', () => {
  const base = estimatePrice({ origin, destination, category: 'green' });
  const surged = estimatePrice({ origin, destination, category: 'green' }, { surgeMultiplier: 2 });
  const discounted = estimatePrice({ origin, destination, category: 'green' }, { discountRate: 0.5 });
  assert.ok(surged.amount > base.amount);
  assert.ok(discounted.amount < base.amount);
});

test('catégorie van plus chère que eco', () => {
  const eco = estimatePrice({ origin, destination, category: 'eco' });
  const van = estimatePrice({ origin, destination, category: 'van' });
  assert.ok(van.amount > eco.amount);
});

test('le breakdown est fourni (transparence)', () => {
  const r = estimatePrice({ origin, destination, category: 'green' });
  assert.ok('base' in r.breakdown && 'distance' in r.breakdown && 'time' in r.breakdown);
});
