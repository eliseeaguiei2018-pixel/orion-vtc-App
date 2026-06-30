import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { latLng, parse } from '../../core/validate.js';
import type { ServiceType } from '../services/types.js';

const estimateSchema = z.object({
  serviceType: z.enum(['ride', 'delivery', 'micromobility']).default('ride'),
  origin: latLng,
  destination: latLng,
  stops: z.array(latLng).max(5).optional(),
  category: z.string().optional(),
  bodyType: z.enum(['suv', 'berline']).optional(),
  promoCode: z.string().optional(),
});

/**
 * Estimation de prix AVANT validation. Le devis est verrouillé (lockId + expiresAt) :
 * c'est ce lockId que le client renverra pour créer la course au MÊME prix (transparence).
 */
export async function pricingRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.post('/pricing/estimate', async (req) => {
    const body = parse(estimateSchema, req.body);
    const service = container.registry.get(body.serviceType as ServiceType);
    const quote = await service.estimate({
      origin: body.origin,
      destination: body.destination,
      stops: body.stops,
      category: body.category,
      bodyType: body.bodyType,
      promoCode: body.promoCode,
    });
    container.rides.saveQuote(quote);
    return { quote };
  });

  app.get('/services', async () => ({ services: container.registry.list() }));
}
