import { z } from 'zod';

/**
 * Configuration centralisée et validée.
 * 12-factor : toute la configuration provient de l'environnement.
 * Aucune valeur secrète n'est codée en dur.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Limitation de débit (back-pressure) — protège contre la surcharge.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  // Verrouillage d'estimation de prix.
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(120),

  // Délai d'acceptation d'une offre par un chauffeur.
  OFFER_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(15),

  // Arrêt en douceur : délai max pour drainer les requêtes en cours.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Présence chauffeur : TTL de la position dans l'index géo.
  PRESENCE_TTL_SECONDS: z.coerce.number().int().positive().default(30),

  // En prod : 'redis'. En local/test : 'memory' (aucune infra requise).
  GEO_BACKEND: z.enum(['memory', 'redis']).default('memory'),

  // Partenariat Google Maps (Directions / Distance Matrix / Places).
  // Optionnel : sans clé, on bascule sur un calcul interne (haversine) — l'app fonctionne.
  GOOGLE_MAPS_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Configuration invalide:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
