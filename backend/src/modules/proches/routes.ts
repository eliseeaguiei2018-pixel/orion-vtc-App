import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { trafficInfo, isWithinCotedIvoire } from '../geo-ci/zones.js';
import { badRequest } from '../../core/errors.js';
import { multiplicateur } from '../rides/demand.js';

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
/**
 * OFFRE ET DEMANDE AUTOUR DU CLIENT — ce que montre la pastille de la carte, avec EXACTEMENT la
 * règle du prix : chauffeurs libres et commandes des 10 dernières minutes à moins de 1,2 km,
 * majoration de forte demande (×1,3 ou ×1,5 selon l'écart) et majoration manuelle de zone,
 * le tout plafonné (incitation verte, réglage console).
 *  - vert   : prix habituel ;
 *  - jaune  : un peu plus de commandes que de chauffeurs, prix légèrement majoré ;
 *  - orange : beaucoup plus de commandes que de chauffeurs (la hausse reste plafonnée).
 */
export async function tensionAutour(container: Container, p: { lat: number; lng: number }) {
  const ops = container.settings.getOps();
  const m = await container.demand.marcheEn(p);
  const demande = m.demandeReelle + m.demandeSimulee;
  const offre = m.offreReelle + m.offreSimulee;
  const brut = ops.surgeEnabled && demande >= 3 ? multiplicateur(demande, offre) : 1;
  const manuel = container.settings.zoneForPoint(p)?.surgeManual ?? 1;
  const majoration = Math.min(Math.max(brut, manuel), ops.surgeCapGreen);
  const niveau = majoration <= 1.0001 ? 'vert' : brut >= 1.5 ? 'orange' : 'jaune';
  return {
    niveau,
    majorationPct: Math.round((majoration - 1) * 100),
    plafondPct: Math.round((ops.surgeCapGreen - 1) * 100),
    // Commandes par chauffeur libre : 1 = équilibre, au-delà de 1,3 le prix monte.
    ratio: Math.round((demande / Math.max(1, offre)) * 100) / 100,
    seuil: 1.3,
  } as const;
}

export async function prochesRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.get('/vehicules/proches', async (req, reply) => {
    const { lat, lng } = parse(schema, req.query);
    const p = { lat, lng };
    if (!isWithinCotedIvoire(p)) throw badRequest('Position hors zone de service (Côte d’Ivoire)', { code: 'OUT_OF_SERVICE_AREA' });
    const r = await container.proches.autour(p, trafficInfo(p, p).factor);
    reply.header('cache-control', 'no-store');
    // `marche` change quand le simulateur du PDG change : l'app refait alors son devis.
    // `tension` : l'équilibre chauffeurs / commandes autour du client (pastille de la carte).
    return { ...r, marche: container.simulateur.rev, tension: await tensionAutour(container, p), at: new Date().toISOString() };
  });
}
