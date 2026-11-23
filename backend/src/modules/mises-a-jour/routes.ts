import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';
import { estApp } from './service.js';

/**
 * Routes publiques des mises à jour à chaud : le manifeste signé de chaque app, et ses paquets.
 * Aucune donnée personnelle : seulement le code de l'application, sans clé ni secret (les
 * paquets sont construits sans la clé Google, que l'APK garde sur le téléphone).
 */
export async function misesAJourRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Clé publique de vérification : celle que les APK portent (information publique).
  app.get('/apps/cle-publique', async (_req, reply) => {
    const cle = container.misesAJour.clePublique();
    if (!cle) return reply.code(503).send({ error: { code: 'SIGNATURE_INDISPONIBLE', message: 'Aucune clé de signature' } });
    return { algorithme: 'ECDSA P-256 SHA-256', clePublique: cle };
  });

  app.get('/apps/:app/manifeste', async (req, reply) => {
    const { app: nom } = req.params as { app: string };
    if (!estApp(nom)) return reply.code(404).send({ error: { code: 'APP_INCONNUE', message: 'Application inconnue' } });
    const m = container.misesAJour.manifeste(nom);
    reply.header('cache-control', 'no-cache');
    if (!m) return reply.code(404).send({ error: { code: 'AUCUNE_MISE_A_JOUR', message: 'Aucune mise à jour publiée' } });
    return m;
  });

  app.get('/apps/:app/paquets/:fichier', async (req, reply) => {
    const { app: nom, fichier } = req.params as { app: string; fichier: string };
    const chemin = estApp(nom) ? container.misesAJour.fichier(nom, fichier) : null;
    if (!chemin) return reply.code(404).send({ error: { code: 'PAQUET_INTROUVABLE', message: 'Paquet introuvable' } });
    // Un paquet publié ne change jamais (nouvelle version = nouveau nom) : cache long.
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    reply.type('application/zip');
    return reply.send(createReadStream(chemin));
  });
}
