import { randomUUID } from 'node:crypto';
import { config } from '../../../config/index.js';
import { badRequest } from '../../../core/errors.js';
import type { EstimateRequest, Quote, ServiceModule } from '../types.js';
import { estimatePrice, type PricingContext } from './pricing.js';
import { isWithinCotedIvoire } from '../../geo-ci/zones.js';
import { dansDistrictAbidjan } from '../../geo-ci/abidjan.js';

/** Fournit le contexte de tarification dynamique (surge, promo) pour une demande. */
export type PricingContextProvider = (req: EstimateRequest) => PricingContext | Promise<PricingContext>;

/**
 * Implémentation VTC du contrat ServiceModule. Première brique du moteur multi-service.
 */
export class RideServiceModule implements ServiceModule {
  readonly type = 'ride' as const;
  readonly supplyKind = 'driver' as const;

  constructor(private readonly contextProvider: PricingContextProvider = () => ({})) {}

  async estimate(req: EstimateRequest): Promise<Quote> {
    if (!isFinite(req.origin?.lat) || !isFinite(req.destination?.lat)) {
      throw badRequest('Coordonnées origine/destination requises');
    }
    // Zone de service : ORION opère en Côte d'Ivoire.
    if (!isWithinCotedIvoire(req.origin) || !isWithinCotedIvoire(req.destination)) {
      throw badRequest('Trajet hors zone de service (Côte d\'Ivoire)', {
        code: 'OUT_OF_SERVICE_AREA',
      });
    }
    // Mise à disposition à l'heure : offre réservée au district d'Abidjan.
    if (req.miseADisposition && !dansDistrictAbidjan(req.origin)) {
      throw badRequest('La mise à disposition à l\'heure n\'est proposée qu\'à Abidjan', { code: 'MISE_A_DISPOSITION_HORS_ABIDJAN' });
    }
    const price = estimatePrice(req, await this.contextProvider(req));
    const now = Date.now();
    return {
      lockId: randomUUID(),
      serviceType: this.type,
      category: price.category,
      amount: price.amount,
      currency: price.currency,
      origin: req.origin,
      destination: req.destination,
      stops: req.stops,
      distanceMeters: price.distanceMeters,
      etaSeconds: price.etaSeconds,
      trafficLevel: price.trafficLevel,
      breakdown: price.breakdown,
      // Le choix du client voyage avec le devis : la course, le chauffeur et la console le lisent.
      ...(req.itineraire && !req.miseADisposition ? { itineraire: { choix: req.itineraire, peages: req.itineraire === 'peage' ? [...new Set(req.peages ?? [])] : [] } } : {}),
      ...(req.miseADisposition ? { miseADisposition: { heures: price.breakdown.heures ?? req.miseADisposition.heures, ...(req.miseADisposition.debut ? { debut: req.miseADisposition.debut } : {}) } } : {}),
      expiresAt: new Date(now + config.QUOTE_TTL_SECONDS * 1000).toISOString(),
    };
  }
}
