import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { badRequest } from '../../core/errors.js';

/**
 * LECTURES GROUPÉES DE LA CONSOLE (POST /admin/lot).
 *
 * À chaque actualisation, la console du PDG lisait une soixantaine de pages du serveur l'une
 * après l'autre (vue d'ensemble, courses, flotte, finances…). Depuis Abidjan, chaque aller-retour
 * vers le serveur coûte 0,2 à 0,5 s : une actualisation prenait 10 à 20 secondes. Ici, la console
 * envoie UNE requête avec la liste des pages ; le serveur les lit toutes en parallèle et renvoie
 * une seule réponse compressée. Résultat : une actualisation en un aller-retour.
 *
 * Sécurité : chaque page est relue par le serveur AVEC LES DROITS DU DEMANDEUR (mêmes cookies,
 * jeton, appareil, adresse) : une page interdite renvoie son refus 403, signalé à la direction
 * comme d'habitude. Seules des lectures (GET) de pages /admin/ sont permises.
 */

/** Marque interne des lectures relayées : connue du seul processus, jamais envoyée au dehors. */
export const MARQUE_LOT = randomBytes(24).toString('base64url');
export const ENTETE_LOT = 'x-orion-lot';

/** Lecture relayée par /admin/lot : déjà comptée par le limiteur (la requête groupée elle-même). */
export const estLectureGroupee = (req: FastifyRequest): boolean => req.headers[ENTETE_LOT] === MARQUE_LOT;

export const LOT_MAX = 100;
const CHEMIN = /^\/admin\/[A-Za-z0-9/_\-.~%]*(\?[A-Za-z0-9_\-.~%=&+,:]*)?$/;
/** En-têtes propres à la connexion d'origine : ils ne passent pas aux lectures relayées. */
const NON_RELAYES = new Set(['host', 'content-length', 'content-type', 'connection', 'accept-encoding', 'transfer-encoding', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', ENTETE_LOT, 'upgrade', 'expect']);

const schema = z.object({ chemins: z.array(z.string().min(7).max(400)).min(1).max(LOT_MAX) });

export function lotRoutes(scoped: FastifyInstance, app: FastifyInstance): void {
  scoped.post('/admin/lot', async (req) => {
    const parse = schema.safeParse(req.body);
    if (!parse.success) throw badRequest('Liste de pages invalide (1 à 100 pages /admin/…)');
    const chemins = [...new Set(parse.data.chemins)];
    for (const c of chemins) {
      if (!CHEMIN.test(c) || c.includes('..') || c.includes('//') || c.split('?')[0]!.startsWith('/admin/lot')) {
        throw badRequest(`Page non lisible en lot : ${c.slice(0, 80)}`);
      }
    }
    const entetes: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string' && !NON_RELAYES.has(k)) entetes[k] = v;
    }
    entetes[ENTETE_LOT] = MARQUE_LOT;
    const lus = await Promise.all(chemins.map(async (chemin) => {
      try {
        const r = await app.inject({ method: 'GET', url: chemin, headers: entetes, remoteAddress: req.ip });
        let corps: unknown = null;
        if (String(r.headers['content-type'] ?? '').includes('application/json')) {
          try { corps = r.json(); } catch { corps = null; }
        }
        return [chemin, { s: r.statusCode, b: corps }] as const;
      } catch {
        return [chemin, { s: 500, b: null }] as const;
      }
    }));
    return { r: Object.fromEntries(lus) };
  });
}
