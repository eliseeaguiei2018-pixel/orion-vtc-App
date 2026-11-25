import type { z } from 'zod';
import { badRequest } from './errors.js';

/**
 * Valide une entrée avec un schéma Zod et lève une erreur 400 homogène si invalide.
 * Renvoie le type de SORTIE du schéma (valeurs par défaut appliquées).
 */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('Entrée invalide', result.error.flatten());
  }
  return result.data;
}

import { z as zod } from 'zod';

export const latLng = zod.object({
  lat: zod.number().min(-90).max(90),
  lng: zod.number().min(-180).max(180),
});
