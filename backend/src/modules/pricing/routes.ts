import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { latLng, parse } from '../../core/validate.js';
import type { ServiceType } from '../services/types.js';
import { exigerDossierAssurance } from '../assurance/routes.js';

const estimateSchema = z.object({
  serviceType: z.enum(['ride', 'delivery', 'micromobility']).default('ride'),
  origin: latLng,
  destination: latLng,
  stops: z.array(latLng).max(5).optional(),
  category: z.string().optional(),
  bodyType: z.enum(['suv', 'berline']).optional(),
  insurance: z.boolean().optional(),
  promoCode: z.string().optional(),
  clientId: z.string().max(64).optional(),
});

/**
 * Estimation de prix AVANT validation. Le devis est verrouillé (lockId + expiresAt) :
 * c'est ce lockId que le client renverra pour créer la course au MÊME prix (transparence).
 */
export async function pricingRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.post('/pricing/estimate', async (req) => {
    const body = parse(estimateSchema, req.body);
    // ORION Assurance : sans dossier de premiers secours, l'option ne peut pas être activée.
    if (body.insurance && body.serviceType === 'ride') exigerDossierAssurance(container, body.clientId);
    const service = container.registry.get(body.serviceType as ServiceType);
    const quote = await service.estimate({
      origin: body.origin,
      destination: body.destination,
      stops: body.stops,
      category: body.category,
      bodyType: body.bodyType,
      insurance: body.insurance,
      promoCode: body.promoCode,
      clientId: body.clientId,
    });
    container.rides.saveQuote(quote);
    // ABONNEMENT ORION — APERÇU SEULEMENT : on montre ce que le forfait couvrirait
    // sans consommer le quota. Le quota n'est débité qu'à la création de la course
    // (même principe que le surge : une consultation ne modifie pas l'état).
    const abonnement = body.clientId
      ? container.subscriptions.apercu(body.clientId, { amount: quote.amount, tier: quote.category })
      : null;
    return { quote, abonnement };
  });

  app.get('/services', async () => ({ services: container.registry.list() }));
}
