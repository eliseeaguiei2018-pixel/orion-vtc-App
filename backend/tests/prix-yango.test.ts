import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRICING, estimatePrice } from '../src/modules/services/ride/pricing.js';

/**
 * ORION NETTEMENT MOINS CHER QUE YANGO.
 *
 * La flotte ORION est 100 % électrique : pas de carburant à répercuter, pas de commission de
 * 18 à 25 % prélevée sur le chauffeur. La grille par défaut doit donc rester loin sous Yango.
 * Repère : estimations publiques de Yango Standard à Abidjan (500 F + 250 F/km, minimum
 * 1 000 F), sans compter le temps de trajet ni la tarification dynamique de Yango : le repère
 * est donc favorable à Yango, et l'écart réel est plus grand.
 */
const COCODY = { lat: 5.3596, lng: -3.9903 }; // commune au facteur 1 (ni majorée ni minorée)
const yangoStandard = (km: number) => Math.max(1000, 500 + 250 * km);

test('l’Argent coûte au moins 35 % de moins que Yango Standard, le Diamant reste sous Yango Standard', () => {
  for (const km of [2, 3, 5, 8, 10, 15, 20, 30]) {
    const destination = { lat: COCODY.lat + km / 150, lng: COCODY.lng };
    const prix = (g: 'argent' | 'or' | 'diamant') => estimatePrice({ origin: COCODY, destination, category: g }, { settings: DEFAULT_PRICING, routeMeters: km * 1000 }).amount;
    const y = yangoStandard(km);
    assert.ok(prix('argent') <= y * 0.65, `${km} km : Argent ${prix('argent')} F pour ${y} F chez Yango`);
    assert.ok(prix('diamant') < y * 0.8, `${km} km : Diamant ${prix('diamant')} F pour ${y} F chez Yango`);
  }
});
