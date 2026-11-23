import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { trafficInfo, isWithinCotedIvoire } from '../geo-ci/zones.js';
import { badRequest } from '../../core/errors.js';

const schema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/**
 * GET /vehicules/proches?lat&lng — ce que l'app cliente affiche avant la commande :
 * les véhicules libres autour du client (positions anonymes, cap de l'icône) et, par gamme,
 * le temps d'approche du chauffeur libre le plus proche. L'app interroge toutes les 4 s
 * tant que la carte est à l'écran ; les clients voisins partagent le même calcul (cache).
 */
export async function prochesRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.get('/vehicules/proches', async (req, reply) => {
    const { lat, lng } = parse(schema, req.query);
    const p = { lat, lng };
    if (!isWithinCotedIvoire(p)) throw badRequest('Position hors zone de service (Côte d’Ivoire)', { code: 'OUT_OF_SERVICE_AREA' });
    const r = await container.proches.autour(p, trafficInfo(p, p).factor);
    reply.header('cache-control', 'no-store');
    // `marche` change quand le simulateur du PDG change : l'app refait alors son devis.
    return { ...r, marche: container.simulateur.rev, at: new Date().toISOString() };
  });
}
