import type { FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { verifyDriverToken } from '../modules/driver-app/auth.js';
import { verifyClientToken } from '../modules/clients/auth.js';
import { verifyToken } from '../modules/admin/auth.js';
import { SESSION_COOKIE } from '../modules/admin/cookies.js';

/**
 * CLÉ DU LIMITEUR DE DÉBIT : par compte vérifié, sinon par adresse.
 *
 * En Côte d'Ivoire, les opérateurs mobiles font sortir des milliers d'abonnés par la même
 * adresse publique (NAT d'opérateur). Un plafond par adresse seule bloquerait des testeurs
 * honnêtes dès que quelques dizaines partagent la même antenne. Le plafond porte donc sur
 * le COMPTE quand la requête présente une session valide (signature vérifiée : un jeton
 * inventé ne crée pas de nouveau compteur), et sur l'adresse sinon.
 */
const cache = new Map<string, { cle: string; jusqua: number }>();
const DUREE_CACHE_MS = 60_000;

function compteDuJeton(jeton: string): string | null {
  const vu = cache.get(jeton);
  const maintenant = Date.now();
  if (vu && vu.jusqua > maintenant) return vu.cle;
  const chauffeur = verifyDriverToken(jeton);
  const client = chauffeur ? null : verifyClientToken(jeton);
  const staff = chauffeur || client ? null : verifyToken(jeton);
  const cle = chauffeur ? `chauffeur:${chauffeur}` : client ? `client:${client}` : staff ? `staff:${staff.username ?? staff.name}` : null;
  if (cle) {
    if (cache.size > 20_000) cache.clear();
    cache.set(jeton, { cle, jusqua: maintenant + DUREE_CACHE_MS });
  }
  return cle;
}

export function cleDeLimite(req: FastifyRequest): string {
  const h = req.headers.authorization;
  const bearer = h ? /^Bearer\s+(.+)$/i.exec(h.trim())?.[1] : undefined;
  if (bearer) {
    const cle = compteDuJeton(bearer);
    if (cle) return cle;
  }
  // Canal temps réel de l'app chauffeur : le jeton voyage dans l'adresse (`?token=`), un
  // WebSocket ne pouvant pas porter d'en-tête Authorization.
  const jetonAdresse = (req.query as Record<string, unknown> | undefined)?.['token'];
  if (typeof jetonAdresse === 'string' && jetonAdresse.length > 20) {
    const cle = compteDuJeton(jetonAdresse);
    if (cle) return cle;
  }
  // Console dans un navigateur : session en cookie HttpOnly.
  const cookie = req.headers.cookie;
  if (cookie && cookie.includes(`${SESSION_COOKIE}=`)) {
    const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookie);
    if (m?.[1]) {
      const cle = compteDuJeton(decodeURIComponent(m[1]));
      if (cle) return cle;
    }
  }
  // Ouverture d'un canal temps réel anonyme (configuration publique, suivi d'une course) :
  // compteur à part, bien plus large. Derrière l'adresse partagée d'un opérateur mobile, des
  // centaines de téléphones ouvrent (et rouvrent, au gré du réseau) leur canal en même temps.
  if (String(req.headers.upgrade ?? '').toLowerCase() === 'websocket') return `ws:${req.ip}`;
  return `ip:${req.ip}`;
}

/** Plafond par minute selon la nature de la clé (compte, personnel ORION, adresse). */
export function plafondDeLimite(_req: FastifyRequest, cle: string): number {
  if (cle.startsWith('staff:')) return config.RATE_LIMIT_MAX_STAFF;
  if (cle.startsWith('ip:')) return config.RATE_LIMIT_MAX_IP;
  if (cle.startsWith('ws:')) return config.RATE_LIMIT_MAX_WS_IP;
  return config.RATE_LIMIT_MAX;
}
