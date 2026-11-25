import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinCotedIvoire, nearestZone, zoneSurge, ALL_ZONES } from '../src/modules/geo-ci/zones.js';

test('un point d’Abidjan est dans la zone de service', () => {
  assert.equal(isWithinCotedIvoire({ lat: 5.3236, lng: -4.0217 }), true);
});

test('Paris est hors zone de service', () => {
  assert.equal(isWithinCotedIvoire({ lat: 48.8566, lng: 2.3522 }), false);
});

test('rattachement à la commune la plus proche', () => {
  const r = nearestZone({ lat: 5.3236, lng: -4.0217 });
  assert.equal(r?.zone.name, 'Plateau');
});

test('l’aéroport FHB a un fort coefficient de demande', () => {
  const surge = zoneSurge({ lat: 5.2614, lng: -3.9263 }, { lat: 5.3236, lng: -4.0217 }, new Date('2026-06-29T12:00:00Z'));
  assert.ok(surge > 1.2);
});

test('le surge est borné à 2', () => {
  const surge = zoneSurge({ lat: 5.2614, lng: -3.9263 }, { lat: 5.3580, lng: -4.0240 }, new Date('2026-06-29T18:00:00'));
  assert.ok(surge <= 2);
});

test('le référentiel contient les communes d’Abidjan et des villes du pays', () => {
  const names = ALL_ZONES.map((z) => z.name);
  assert.ok(names.includes('Cocody'));
  assert.ok(names.includes('Yopougon'));
  assert.ok(names.includes('Yamoussoukro'));
  assert.ok(names.includes('Bouaké'));
});
