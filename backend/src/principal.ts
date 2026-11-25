import { config } from './config/index.js';
import { logger } from './core/logger.js';
import { buildApp } from './app.js';
import { seedDemoDrivers } from './container.js';

/**
 * Démarrage du serveur, une fois les secrets chargés (voir server.ts). Gère un arrêt en douceur (graceful shutdown) : à la réception
 * d'un signal, on cesse d'accepter de nouvelles connexions et on draine les requêtes en
 * cours avant de quitter — indispensable pour des déploiements sans interruption (rolling).
 */
export async function main(): Promise<void> {
  const { app, container } = await buildApp();

  // Aide de développement : chauffeurs en ligne pour démontrer le suivi temps réel.
  if (config.SIMULATE_RIDES) {
    await seedDemoDrivers(container);
    logger.info('Chauffeurs de démonstration en ligne (SIMULATE_RIDES=true)');
  }

  await app.listen({ host: config.HOST, port: config.PORT, backlog: config.LISTEN_BACKLOG });
  logger.info(`ORION VTC API à l'écoute sur http://${config.HOST}:${config.PORT}`);
  // Opérateur SMS : sans lui, aucun client ni chauffeur ne peut recevoir son code.
  if (container.sms.reel) {
    logger.info({ fournisseur: container.sms.fournisseur, expediteur: config.SMS_SENDER_NAME }, 'Opérateur SMS actif');
  } else if (config.NODE_ENV === 'production') {
    logger.warn('Aucun opérateur SMS (SMS_PROVIDER=console) : les connexions par code sont refusées. Configurer SMS_PROVIDER=orange.');
  }
  // Codes par WhatsApp : actifs, ou réglage Meta incomplet (un seul des deux renseigné).
  if (container.whatsapp) {
    logger.warn({ fournisseur: container.whatsapp.fournisseur, modele: config.META_WHATSAPP_TEMPLATE }, 'Codes de connexion par WhatsApp actifs');
  } else if (Boolean(config.META_WHATSAPP_PHONE_ID) !== Boolean(config.META_WHATSAPP_TOKEN)) {
    logger.warn('WhatsApp (Meta) désactivé : META_WHATSAPP_PHONE_ID et META_WHATSAPP_TOKEN doivent être renseignés tous les deux.');
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Signal ${signal} reçu — arrêt en douceur…`);
    const timer = setTimeout(() => {
      logger.error('Délai d’arrêt dépassé — sortie forcée');
      process.exit(1);
    }, config.SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    try {
      await app.close();
      logger.info('Arrêt propre terminé');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Erreur pendant l’arrêt');
      process.exit(1);
    }
  };

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => void shutdown(sig));
  }

  // Filets de sécurité : ne jamais laisser le process dans un état incohérent.
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandledRejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    void shutdown('uncaughtException');
  });
}

