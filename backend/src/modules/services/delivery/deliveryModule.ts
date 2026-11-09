import { randomUUID } from 'node:crypto';
import { config } from '../../../config/index.js';
import { badRequest } from '../../../core/errors.js';
import { haversineMeters, type LatLng } from '../../../core/geo.js';
import type { EstimateRequest, Quote, ServiceModule } from '../types.js';
import { DEFAULT_PRICING, type PricingContext } from '../ride/pricing.js';
import { isWithinCotedIvoire } from '../../geo-ci/zones.js';

/**
 * LIVRAISON À MOTO (coursier) — seconde implémentation du contrat ServiceModule.
 *
 * Le service était annoncé partout (bascule dans la console, tuile dans l'app cliente,
 * drapeau `services.delivery` de /config) mais AUCUN module ne l'implémentait : le
 * registre ne contenait que la course. L'app cliente simulait donc le coursier, même
 * backend connecté — aucune livraison n'était réellement enregistrée.
 *
 * Tarification alignée sur celle qu'affichait l'app cliente, pour que le prix annoncé
 * reste identique : base plus faible qu'une course, moto plus rapide (26 km/h), et un
 * facteur selon la taille du colis. Mêmes règles transverses que la course : trafic
 * intégré au prix (jamais facturé à part), codes promo de la console, TVA 5 % et frais
 * de service 10 % — le montant affiché est le montant payé (prix fixe garanti).
 */

/** Tailles de colis acceptées et leur facteur de prix. */
export const PACKAGE_FACTOR: Record<string, number> = { petit: 1, moyen: 1.15, grand: 1.35 };
export const DEFAULT_PACKAGE = 'moyen';

/** Barème coursier (F CFA) — distinct de celui des voitures. */
export const DELIVERY_TARIFF = {
  baseFare: 450,
  perKm: 150,
  perMinute: 14,
  minFare: 500,
  avgSpeedKmh: 26, // la moto se faufile : plus rapide qu'une voiture en ville
  currency: 'XOF',
} as const;

export type DeliveryContextProvider = (req: EstimateRequest) => PricingContext | Promise<PricingContext>;

const roundFcfa = (n: number) => Math.round(n / 50) * 50;

/** Distance du trajet origine → arrêts → destination (mètres). */
function routeDistanceMeters(origin: LatLng, destination: LatLng, stops: LatLng[]): number {
  const pts = [origin, ...stops, destination];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += haversineMeters(pts[i - 1]!, pts[i]!);
  return total;
}

export class DeliveryServiceModule implements ServiceModule {
  readonly type = 'delivery' as const;
  readonly supplyKind = 'courier' as const;

  constructor(private readonly contextProvider: DeliveryContextProvider = () => ({})) {}

  async estimate(req: EstimateRequest): Promise<Quote> {
    if (!isFinite(req.origin?.lat) || !isFinite(req.destination?.lat)) {
      throw badRequest('Coordonnées origine/destination requises');
    }
    if (!isWithinCotedIvoire(req.origin) || !isWithinCotedIvoire(req.destination)) {
      throw badRequest('Livraison hors zone de service (Côte d\'Ivoire)', { code: 'OUT_OF_SERVICE_AREA' });
    }

    const ctx = await this.contextProvider(req);
    const s = ctx.settings ?? DEFAULT_PRICING;
    // La taille du colis voyage dans `category` (petit | moyen | grand).
    const size = req.category && PACKAGE_FACTOR[req.category] ? req.category : DEFAULT_PACKAGE;
    const sizeFactor = PACKAGE_FACTOR[size]!;

    const stops = req.stops ?? [];
    const distanceMeters = routeDistanceMeters(req.origin, req.destination, stops);
    const distanceKm = distanceMeters / 1000;
    const trafficFactor = Math.max(1, ctx.trafficFactor ?? 1);
    // ETA informative : allongée par le trafic. Temps FACTURÉ : à vitesse libre, pour
    // ne pas faire payer les embouteillages au client.
    const etaSeconds = Math.round((distanceKm / DELIVERY_TARIFF.avgSpeedKmh) * 3600 * trafficFactor);
    const minutes = (distanceKm / DELIVERY_TARIFF.avgSpeedKmh) * 60;

    const base = DELIVERY_TARIFF.baseFare * sizeFactor;
    const distanceCost = distanceKm * DELIVERY_TARIFF.perKm * sizeFactor;
    const timeCost = minutes * DELIVERY_TARIFF.perMinute * sizeFactor;

    // Trafic adouci et intégré au prix (pas de ligne « supplément » séparée).
    const trafficMult = 1 + (trafficFactor - 1) * s.trafficWeight;
    const zoneFactor = Math.max(0.1, ctx.zoneFactor ?? 1);
    const surge = Math.max(1, ctx.surgeMultiplier ?? 1);
    const metered = (base + distanceCost + timeCost) * trafficMult * zoneFactor * surge;
    const floored = Math.max(metered, DELIVERY_TARIFF.minFare);

    // Codes promo de la console (montant calculé prioritaire sur un taux).
    const discountRate = Math.min(1, Math.max(0, ctx.discountRate ?? 0));
    const promo = ctx.promoDiscount ? ctx.promoDiscount(floored) : 0;
    const discount = Math.min(floored, promo > 0 ? promo : floored * discountRate);

    const subtotal = floored - discount;
    const tva = subtotal * s.tvaRate;
    const fee = subtotal * s.feeRate;
    const amount = roundFcfa(subtotal + tva + fee);

    return {
      lockId: randomUUID(),
      serviceType: this.type,
      category: size,
      amount,
      currency: DELIVERY_TARIFF.currency,
      origin: req.origin,
      destination: req.destination,
      stops: req.stops,
      distanceMeters: Math.round(distanceMeters),
      etaSeconds,
      trafficLevel: ctx.trafficLevel ?? 'fluid',
      breakdown: {
        base: Math.round(base),
        distance: Math.round(distanceCost),
        time: Math.round(timeCost),
        surge,
        traffic: 0, // intégré au prix, jamais facturé à part
        discount: Math.round(discount),
        subtotal: Math.round(subtotal),
        tva: Math.round(tva),
        fee: Math.round(fee),
        insurance: 0, // l'assurance ORION couvre les personnes, pas les colis
      },
      expiresAt: new Date(Date.now() + config.QUOTE_TTL_SECONDS * 1000).toISOString(),
    };
  }
}
