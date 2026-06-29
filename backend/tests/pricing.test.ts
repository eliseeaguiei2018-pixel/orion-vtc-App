import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePrice } from '../src/modules/services/ride/pricing.js';

const origin = { lat: 48.8566, lng: 2.3522 }; // Paris
const destination = { lat: 48.8606, lng: 2.3376 }; // Louvre

test('estimation déterministe (même entrée → même prix)', () => {
  const a = estimatePrice({ origin, destination, category: 'green' });
  const b = estimatePrice({ origin, destination, category: 'green' });
  assert.equal(a.amount, b.amount);
  assert.ok(a.amount > 0);
});

test('le prix respecte le tarif minimum', () => {
  const r = estimatePrice({ origin, destination: origin, category: 'green' });
  assert.equal(r.amount, 5); // minFare green
});

test('le surge augmente le prix, la remise le diminue', () => {
  const base = estimatePrice({ origin, destination, category: 'green' });
  const surged = estimatePrice({ origin, destination, category: 'green' }, { surgeMultiplier: 2 });
  const discounted = estimatePrice({ origin, destination, category: 'green' }, { discountRate: 0.5 });
  assert.ok(surged.amount > base.amount);
  assert.ok(discounted.amount < base.amount);
});

test('catégorie van plus chère que green', () => {
  const green = estimatePrice({ origin, destination, category: 'green' });
  const van = estimatePrice({ origin, destination, category: 'van' });
  assert.ok(van.amount > green.amount);
});

test('le breakdown est fourni (transparence)', () => {
  const r = estimatePrice({ origin, destination, category: 'green' });
  assert.ok('base' in r.breakdown && 'distance' in r.breakdown && 'time' in r.breakdown);
});
