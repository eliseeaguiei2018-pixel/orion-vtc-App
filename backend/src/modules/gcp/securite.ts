import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../../config/index.js';
import { AppError } from '../../core/errors.js';
import { AccesGoogle, type Recuperer } from './acces.js';
import { IdentitePlateforme } from './identite.js';
import { ClesGoogle, JetonRefuse, verifierJetonGoogle } from './jetons.js';
import { Recaptcha } from './recaptcha.js';

/**
 * SÉCURITÉ GOOGLE CLOUD DU SERVEUR — ce qui est branché, selon la configuration.
 *
 *  - reCAPTCHA Enterprise : `exigerHumain` avant l'envoi d'un code SMS et avant une connexion
 *    à la console (RECAPTCHA_MODE, RECAPTCHA_SITE_KEY, RECAPTCHA_MIN_SCORE) ;
 *  - Identity Platform : `identite.verifier` pour la route /clients/auth/identity
 *    (IDENTITY_PLATFORM=true, GCP_PROJECT_ID) ;
 *  - API Gateway : `brancherPasserelle` reconnaît les requêtes relayées par la passerelle
 *    (GCP_GATEWAY_SERVICE_ACCOUNT, GCP_GATEWAY_AUDIENCE) et peut refuser toutes les autres
 *    (GCP_GATEWAY_REQUIRED=true).
 * Secret Manager agit avant, au démarrage (secrets.ts) ; Cloud Armor et les restrictions des
 * clés d'API se règlent sur le projet Google (dossier deploy/gcp/).
 * Rien n'est actif sans configuration : le serveur fonctionne à l'identique hors de Google Cloud.
 */
export interface SecuriteGoogle {
  acces: AccesGoogle | null;
  recaptcha: Recaptcha | null;
  identite: IdentitePlateforme | null;
}

export function creerSecuriteGoogle(recuperer?: Recuperer): SecuriteGoogle {
  const utile = config.RECAPTCHA_MODE !== 'off';
  const acces = utile ? new AccesGoogle({ recuperer }) : null;
  return {
    acces,
    recaptcha: acces && config.RECAPTCHA_SITE_KEY
      ? new Recaptcha({ acces, cleSite: config.RECAPTCHA_SITE_KEY, seuil: config.RECAPTCHA_MIN_SCORE, mode: config.RECAPTCHA_MODE })
      : null,
    identite: config.IDENTITY_PLATFORM && config.GCP_PROJECT_ID
      ? new IdentitePlateforme({ projet: config.GCP_PROJECT_ID, locataire: config.IDENTITY_PLATFORM_TENANT, recuperer })
      : null,
  };
}

/**
 * Refuse la demande si reCAPTCHA Enterprise n'y reconnaît pas un humain.
 * Sans reCAPTCHA configuré : ne fait rien. En mode `observe` : journalise et laisse passer.
 */
export async function exigerHumain(s: SecuriteGoogle, req: FastifyRequest, action: string): Promise<void> {
  if (!s.recaptcha?.actif) return;
  const jeton = req.headers['x-recaptcha-token'];
  const e = await s.recaptcha.evaluer({ jeton: typeof jeton === 'string' ? jeton : undefined, action, ip: req.ip, agent: req.headers['user-agent'] });
  // Ni le jeton ni l'adresse complète ne sont journalisés : l'action, le score et le motif suffisent.
  req.log.info({ action, score: e.score, raison: e.raison, motifs: e.motifs, mode: s.recaptcha.mode }, e.ok ? 'reCAPTCHA : accepté' : 'reCAPTCHA : refusé');
  if (e.ok || s.recaptcha.mode === 'observe') return;
  if (e.raison === 'indisponible') throw new AppError(503, 'RECAPTCHA_INDISPONIBLE', 'Vérification de sécurité momentanément indisponible. Réessayez dans un instant.');
  throw new AppError(403, 'RECAPTCHA_REFUSE', 'Vérification de sécurité refusée. Mettez l’application à jour, puis réessayez.');
}

declare module 'fastify' {
  interface FastifyRequest { viaPasserelle?: boolean }
}

/** Chemins joignables sans la passerelle (GCP_GATEWAY_EXEMPT) : santé, temps réel, console. */
const DISPENSES = config.GCP_GATEWAY_EXEMPT.split(',').map((p) => p.trim()).filter((p) => p.startsWith('/'));
const horsPasserelle = (url: string): boolean => {
  const chemin = url.split('?')[0]!;
  return DISPENSES.some((p) => chemin === p || chemin.startsWith(`${p}/`));
};

/**
 * API GATEWAY — reconnaître les requêtes relayées par la passerelle.
 *
 * La passerelle s'identifie auprès du serveur avec un jeton Google signé (en-tête Authorization)
 * et déplace le jeton ORION de l'application dans `x-forwarded-authorization`. Ce crochet
 * vérifie le jeton de la passerelle (signature Google, compte de service et destinataire
 * attendus), puis remet le jeton ORION à sa place : le reste du serveur ne voit aucune différence.
 * Avec GCP_GATEWAY_REQUIRED=true, une requête qui n'arrive pas par la passerelle est refusée,
 * sauf sur les chemins dispensés (GCP_GATEWAY_EXEMPT : santé, temps réel, console).
 */
export function brancherPasserelle(app: FastifyInstance, recuperer?: Recuperer): void {
  const compte = config.GCP_GATEWAY_SERVICE_ACCOUNT;
  const destinataire = config.GCP_GATEWAY_AUDIENCE;
  if (!compte || !destinataire) return;
  const cles = new ClesGoogle('https://www.googleapis.com/oauth2/v3/certs', recuperer);

  app.addHook('onRequest', async (req) => {
    const relaye = req.headers['x-forwarded-authorization'];
    const auth = req.headers.authorization;
    const jeton = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    // Un jeton ORION (HS256) ou l'absence de jeton : la requête n'arrive pas par la passerelle.
    const candidat = jeton && (typeof relaye === 'string' || jeton.split('.').length === 3 && enteteRs256(jeton));
    if (candidat) {
      try {
        const c = await verifierJetonGoogle(jeton, { cles, emetteurs: ['https://accounts.google.com', 'accounts.google.com'], destinataires: [destinataire] });
        if (c.email !== compte || c.email_verified !== true) throw new JetonRefuse('compte de service');
        req.viaPasserelle = true;
        // Le jeton de l'application reprend sa place ; sans lui, la requête est anonyme.
        if (typeof relaye === 'string') req.headers.authorization = relaye; else delete req.headers.authorization;
        delete req.headers['x-forwarded-authorization'];
      } catch (e) {
        // Un en-tête relayé sans jeton de passerelle valide est une tentative d'usurpation.
        if (typeof relaye === 'string') throw new AppError(403, 'PASSERELLE_REFUSEE', 'Requête refusée');
        if (!(e instanceof JetonRefuse)) throw e;
      }
    }
    if (config.GCP_GATEWAY_REQUIRED && !req.viaPasserelle && !horsPasserelle(req.url)) {
      throw new AppError(403, 'PASSERELLE_REQUISE', 'Requête refusée');
    }
  });
}

function enteteRs256(jeton: string): boolean {
  try { return (JSON.parse(Buffer.from(jeton.split('.')[0]!, 'base64url').toString('utf8')) as { alg?: string }).alg === 'RS256'; } catch { return false; }
}
