import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';
import { estApp, type AppOrion } from './service.js';

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

  // Nouvelle APK (moteur natif) : l'app installée compare son versionCode à celui-ci.
  app.get('/apps/:app/version-native', async (req, reply) => {
    const { app: nom } = req.params as { app: string };
    if (!estApp(nom)) return reply.code(404).send({ error: { code: 'APP_INCONNUE', message: 'Application inconnue' } });
    const v = container.misesAJour.versionNative(nom);
    reply.header('cache-control', 'no-cache');
    if (!v) return reply.code(404).send({ error: { code: 'AUCUNE_APK', message: 'Aucune APK publiée' } });
    return v;
  });

  app.get('/apps/:app/apk/:fichier', async (req, reply) => {
    const { app: nom, fichier } = req.params as { app: string; fichier: string };
    const chemin = estApp(nom) ? container.misesAJour.fichierApk(nom, fichier) : null;
    if (!chemin) return reply.code(404).send({ error: { code: 'APK_INTROUVABLE', message: 'APK introuvable' } });
    container.misesAJour.compter(nom as AppOrion, fichier);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    reply.header('content-disposition', `attachment; filename="${fichier}"`);
    reply.type('application/vnd.android.package-archive');
    return reply.send(createReadStream(chemin));
  });

  // Lien court à partager (première installation) : toujours la dernière APK de l'app.
  app.get('/telecharger/:app', async (req, reply) => {
    const { app: brut } = req.params as { app: string };
    const nom = brut === 'pro' ? 'chauffeur' : brut;
    const v = estApp(nom) ? container.misesAJour.versionNative(nom) : null;
    if (!v) return reply.code(404).send({ error: { code: 'AUCUNE_APK', message: 'Aucune APK publiée pour cette application' } });
    reply.header('cache-control', 'no-cache');
    return reply.redirect(v.chemin, 302);
  });

  app.get('/apps/:app/paquets/:fichier', async (req, reply) => {
    const { app: nom, fichier } = req.params as { app: string; fichier: string };
    const chemin = estApp(nom) ? container.misesAJour.fichier(nom, fichier) : null;
    if (!chemin) return reply.code(404).send({ error: { code: 'PAQUET_INTROUVABLE', message: 'Paquet introuvable' } });
    container.misesAJour.compter(nom as AppOrion, fichier);
    // Un paquet publié ne change jamais (nouvelle version = nouveau nom) : cache long.
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    reply.type('application/zip');
    return reply.send(createReadStream(chemin));
  });
}
