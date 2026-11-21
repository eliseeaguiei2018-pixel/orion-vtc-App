import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRICING, SINUOSITE, distanceFacturee, estimatePrice } from '../src/modules/services/ride/pricing.js';
import { haversineMeters } from '../src/core/geo.js';

/**
 * Le prix se calcule sur le trajet PAR LA ROUTE, pas à vol d'oiseau : avant cette règle, une
 * course de 7,6 km par la route (5 km en ligne droite) était facturée comme une course de 5 km.
 */
const RIVIERA = { lat: 5.3458, lng: -4.001 };
const PLATEAU = { lat: 5.3237, lng: -4.017 };
const MARCORY = { lat: 5.3009, lng: -3.9836 };   // de l'autre côté de la lagune : la route fait un grand détour

test('sans itinéraire calculé, la route est estimée à 1,3 fois le vol d’oiseau', () => {
  const vol = haversineMeters(RIVIERA, PLATEAU);
  assert.equal(SINUOSITE, 1.3);
  assert.equal(Math.round(distanceFacturee(RIVIERA, PLATEAU, [])), Math.round(vol * 1.3));
  assert.equal(estimatePrice({ origin: RIVIERA, destination: PLATEAU }).distanceMeters, Math.round(vol * 1.3));
});

test('avec un itinéraire, la distance facturée est celle de la route', () => {
  const vol = haversineMeters(RIVIERA, MARCORY);
  const route = Math.round(vol * 2.1);            // pont et échangeurs : plus du double de la ligne droite
  const devis = estimatePrice({ origin: RIVIERA, destination: MARCORY }, { routeMeters: route });
  assert.equal(devis.distanceMeters, route);
  const estime = estimatePrice({ origin: RIVIERA, destination: MARCORY });
  assert.ok(devis.amount > estime.amount, `le détour par le pont se paie : ${devis.amount} F contre ${estime.amount} F`);
});

test('un itinéraire invraisemblable est écarté', () => {
  const vol = haversineMeters(RIVIERA, PLATEAU);
  const estime = Math.round(vol * 1.3);
  // Plus court que la ligne droite, nul, infini ou démesuré : on revient à l'estimation.
  for (const faux of [vol * 0.5, 0, Number.NaN, Number.POSITIVE_INFINITY, vol * 6 + 3001]) {
    assert.equal(Math.round(distanceFacturee(RIVIERA, PLATEAU, [], faux)), estime, `distance ${faux}`);
  }
});

test('le prix suit la distance par la route, arrêts compris', () => {
  const direct = estimatePrice({ origin: RIVIERA, destination: PLATEAU });
  const avecArret = estimatePrice({ origin: RIVIERA, destination: PLATEAU, stops: [MARCORY] });
  assert.ok(avecArret.distanceMeters > direct.distanceMeters);
  assert.ok(avecArret.amount > direct.amount);
  // Le prix facturé à vol d'oiseau (ancienne règle) était plus bas que le prix sur la route.
  const vol = haversineMeters(RIVIERA, PLATEAU);
  const ancien = estimatePrice({ origin: RIVIERA, destination: PLATEAU }, { routeMeters: vol });
  assert.ok(direct.amount > ancien.amount, `${direct.amount} F sur la route, ${ancien.amount} F à vol d’oiseau`);
});

test('supplément fixe par course : 700 F de plus sur chaque gamme, écarts entre gammes inchangés', () => {
  assert.equal(DEFAULT_PRICING.rideFee, 700);
  const sansSupplement = { ...DEFAULT_PRICING, rideFee: 0 };
  const prix: Record<string, number> = {};
  for (const gamme of ['argent', 'or', 'diamant']) {
    const avec = estimatePrice({ origin: RIVIERA, destination: MARCORY, category: gamme });
    const sans = estimatePrice({ origin: RIVIERA, destination: MARCORY, category: gamme }, { settings: sansSupplement });
    assert.equal(avec.amount - sans.amount, 700, `${gamme} : exactement 700 F de plus`);
    // Le détail reste juste : sous-total, TVA et frais retombent sur le montant affiché.
    const b = avec.breakdown;
    assert.ok(Math.abs(b.subtotal + b.tva + b.fee - avec.amount) <= 2, `${gamme} : détail cohérent avec ${avec.amount} F`);
    prix[gamme] = avec.amount;
  }
  assert.equal(prix.or! - prix.argent!, 700);
  assert.equal(prix.diamant! - prix.argent!, 1700);
  // La console peut le régler : à 1 000 F, chaque course monte de 300 F de plus.
  const regle = estimatePrice({ origin: RIVIERA, destination: MARCORY, category: 'argent' }, { settings: { ...DEFAULT_PRICING, rideFee: 1000 } });
  assert.equal(regle.amount - prix.argent!, 300);
});

