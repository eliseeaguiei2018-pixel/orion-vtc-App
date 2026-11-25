import { pino, type LoggerOptions } from 'pino';
import { config } from '../config/index.js';

/**
 * Options de log partagées : logs structurés (JSON) en production pour l'observabilité
 * (corrélation, agrégation), sortie lisible via pino-pretty en développement.
 * En test : silencieux pour ne pas polluer la sortie.
 */
export const loggerOptions: LoggerOptions = {
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
    : {}),
};

/** Logger autonome pour les logs hors requête (démarrage, arrêt). */
export const logger = pino(loggerOptions);

export type Logger = typeof logger;
