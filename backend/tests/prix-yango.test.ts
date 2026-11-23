import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRICING, estimatePrice } from '../src/modules/services/ride/pricing.js';
import { DEFAULT_ZONES } from '../src/modules/settings/service.js';

/**
 * ORION ENVIRON 40 % MOINS CHER QUE YANGO, sur un RELEVÉ RÉEL de l'application Yango
 * (23/11/2026, trafic dense) : Église Saint-Bernard (Riviera Golf, Cocody) → bord de lagune,
 * environ 5,5 km et 16 min. Yango : Éco 1 500 F, Confort 1 800 F, Confort+ 2 100 F.
 * La flotte ORION est 100 % électrique : pas de carburant à répercuter, pas de commission de
 * 18 à 25 % prélevée sur le chauffeur.
 */
const SAINT_BERNARD = { lat: 5.3697406, lng: -3.9809434 };
const LAGUNE = { lat: 5.33, lng: -3.98 };
const YANGO = { eco: 1500, confort: 1800, confortPlus: 2100 };

test('trajet relevé chez Yango : Argent ≈ 40 % sous Yango Éco, Or et Diamant bien sous Confort et Confort+', () => {
  const golf = DEFAULT_ZONES.find((z) => z.id === 'riviera-golf')!;
  const ctx = { settings: DEFAULT_PRICING, routeMeters: 5500, trafficFactor: 1.15, zoneFactor: golf.factor, zonePickupFee: golf.pickupFee ?? 0 };
  const prix = (g: 'argent' | 'or' | 'diamant') => estimatePrice({ origin: SAINT_BERNARD, destination: LAGUNE, category: g }, ctx).amount;
  const ecart = 1 - prix('argent') / YANGO.eco;
  assert.ok(ecart >= 0.36 && ecart <= 0.46, `Argent ${prix('argent')} F pour ${YANGO.eco} F chez Yango (${Math.round(ecart * 100)} %)`);
  assert.ok(prix('or') <= YANGO.confort * 0.6, `Or ${prix('or')} F`);
  assert.ok(prix('diamant') <= YANGO.confortPlus * 0.6, `Diamant ${prix('diamant')} F`);
  // Grille entre gammes : Or ≈ Argent + 5 %, Diamant ≈ Argent + 15 % (arrondis à 50 F).
  assert.ok(Math.abs(prix('or') - prix('argent') * 1.05) <= 50);
  assert.ok(Math.abs(prix('diamant') - prix('argent') * 1.15) <= 50);
});

test('aucun frais fixe de prise en charge par secteur (Yango n’en fait pas payer)', () => {
  for (const z of DEFAULT_ZONES) assert.ok(!z.pickupFee, `${z.id} : ${z.pickupFee} F`);
});
