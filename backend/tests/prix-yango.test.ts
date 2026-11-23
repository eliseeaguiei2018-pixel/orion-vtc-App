import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRICING, estimatePrice } from '../src/modules/services/ride/pricing.js';
import { DEFAULT_ZONES } from '../src/modules/settings/service.js';
import { haversineMeters } from '../src/core/geo.js';

/**
 * ORION ENVIRON 40 % MOINS CHER QUE YANGO, sur un RELEVÉ RÉEL de l'application Yango
 * (23/11/2026, trafic dense) : Pharmacie Saint-Bernard (Riviera Bonoumin) → bureau de la FAO
 * (Riviera Golf), environ 5 km et 16 min. Yango : Éco 1 500 F, Confort 1 800 F, Confort+ 2 100 F.
 * La flotte ORION est 100 % électrique : pas de carburant à répercuter, pas de commission de
 * 18 à 25 % prélevée sur le chauffeur.
 */
const PHARMACIE_SAINT_BERNARD = { lat: 5.3674291, lng: -3.9795016 };
const FAO_RIVIERA_GOLF = { lat: 5.3374, lng: -3.9785 };
const YANGO = { eco: 1500, confort: 1800, confortPlus: 2100 };

/** Secteur retenu par le serveur : le centre le plus proche parmi ceux qui contiennent le point. */
const secteur = (p: { lat: number; lng: number }) => DEFAULT_ZONES
  .filter((z) => haversineMeters(p, z) <= z.radiusKm * 1000)
  .sort((a, b) => haversineMeters(p, a) - haversineMeters(p, b))[0];

test('trajet relevé chez Yango : Argent ≈ 40 % sous Yango Éco, Or et Diamant bien sous Confort et Confort+', () => {
  // Départ à Riviera Bonoumin : Cocody, sans majoration (Riviera Golf est au bord de la lagune).
  assert.equal(secteur(PHARMACIE_SAINT_BERNARD)?.factor ?? 1, 1);
  assert.equal(secteur(FAO_RIVIERA_GOLF)?.id, 'riviera-golf');
  for (const km of [4.5, 5, 5.5]) {
    const ctx = { settings: DEFAULT_PRICING, routeMeters: km * 1000, trafficFactor: 1.15 };
    const prix = (g: 'argent' | 'or' | 'diamant') => estimatePrice({ origin: PHARMACIE_SAINT_BERNARD, destination: FAO_RIVIERA_GOLF, category: g }, ctx).amount;
    const ecart = 1 - prix('argent') / YANGO.eco;
    assert.ok(ecart >= 0.35 && ecart <= 0.46, `${km} km : Argent ${prix('argent')} F pour ${YANGO.eco} F chez Yango (${Math.round(ecart * 100)} %)`);
    assert.ok(prix('or') <= YANGO.confort * 0.62, `${km} km : Or ${prix('or')} F`);
    assert.ok(prix('diamant') <= YANGO.confortPlus * 0.6, `${km} km : Diamant ${prix('diamant')} F`);
    // Grille entre gammes : Or ≈ Argent + 5 %, Diamant ≈ Argent + 15 % (arrondis à 50 F).
    assert.ok(Math.abs(prix('or') - prix('argent') * 1.05) <= 50);
    assert.ok(Math.abs(prix('diamant') - prix('argent') * 1.15) <= 50);
  }
});

test('aucun frais fixe de prise en charge par secteur (Yango n’en fait pas payer)', () => {
  for (const z of DEFAULT_ZONES) assert.ok(!z.pickupFee, `${z.id} : ${z.pickupFee} F`);
});
