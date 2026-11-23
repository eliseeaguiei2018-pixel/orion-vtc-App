import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { AppError, badRequest } from '../../core/errors.js';
import type { Permission } from '../admin/roles.js';
import { ErreurMiseAJour, TAILLE_MAX, estApp } from './service.js';

type Exiger = (req: FastifyRequest, perm: Permission) => void;
type Journaliser = (req: FastifyRequest, action: string, target?: string, details?: Record<string, unknown>) => void;

/**
 * Console : versions publiées des apps, et publication d'une mise à jour à chaud (direction).
 * Le paquet zip est envoyé tel quel (corps application/zip), avec la version dans l'adresse.
 */
export function misesAJourAdminRoutes(scoped: FastifyInstance, container: Container, exiger: Exiger, journaliser: Journaliser): void {
  scoped.addContentTypeParser(['application/zip', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: TAILLE_MAX }, (_req, corps, fait) => fait(null, corps));

  scoped.get('/admin/mises-a-jour', async (req) => {
    exiger(req, 'services:read');
    return { apps: container.misesAJour.etat(), signature: container.misesAJour.signatureDisponible };
  });

  scoped.put('/admin/mises-a-jour/:app', { bodyLimit: TAILLE_MAX }, async (req) => {
    exiger(req, 'services:write');
    const { app } = req.params as { app: string };
    if (!estApp(app)) throw badRequest('Application inconnue (client, chauffeur ou console)');
    const q = z.object({
      version: z.string().min(1).max(48),
      natifMin: z.coerce.number().int().min(0).max(1_000_000).optional(),
      notes: z.string().max(500).optional(),
    }).safeParse(req.query);
    if (!q.success) throw badRequest('Version, natifMin ou notes invalides');
    if (!Buffer.isBuffer(req.body)) throw badRequest('Envoyer le paquet zip (Content-Type: application/zip)');
    try {
      const m = container.misesAJour.publier(app, req.body, q.data);
      journaliser(req, 'apps.mise_a_jour', app, { version: m.version, natifMin: m.natifMin, taille: m.taille, sha256: m.sha256 });
      return { manifeste: m };
    } catch (e) {
      if (e instanceof ErreurMiseAJour) {
        throw new AppError(e.code === 'SIGNATURE_INDISPONIBLE' ? 503 : e.code === 'DEJA_PUBLIEE' ? 409 : 400, e.code, e.message);
      }
      throw e;
    }
  });
}
