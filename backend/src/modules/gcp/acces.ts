import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * ACCÈS À GOOGLE CLOUD — le jeton que le serveur présente aux API Google.
 *
 * Le serveur ne porte aucune clé écrite dans le dépôt. Il s'identifie de l'une de ces façons,
 * dans cet ordre :
 *  1. sur Cloud Run, GKE ou Compute Engine : le compte de service attaché à l'instance, lu
 *     auprès du serveur de métadonnées — rien à configurer, aucune clé à garder ;
 *  2. ailleurs (autre hébergeur, poste de développement) : un fichier de compte de service
 *     désigné par GOOGLE_APPLICATION_CREDENTIALS, ou son contenu dans GCP_SERVICE_ACCOUNT_JSON.
 *
 * Ce fichier ne lit pas la configuration du serveur : il sert AVANT elle, pour aller chercher
 * les secrets (voir secrets.ts). Aucune dépendance : `fetch` et `node:crypto` suffisent.
 */
export interface CompteService { client_email: string; private_key: string; project_id?: string; token_uri?: string }
export type Recuperer = (url: string, init?: RequestInit) => Promise<Response>;

export interface OptionsAcces {
  env?: Record<string, string | undefined>;
  recuperer?: Recuperer;
  maintenant?: () => number;
}

/** Erreur d'une API Google : le statut HTTP et le message de Google, jamais le jeton ni un secret. */
export class ErreurGoogle extends Error {
  constructor(readonly service: string, readonly statut: number, message: string) {
    super(`${service} : ${statut} ${message}`);
    this.name = 'ErreurGoogle';
  }
}

const METADONNEES = 'http://metadata.google.internal/computeMetadata/v1';
const PORTEE = 'https://www.googleapis.com/auth/cloud-platform';
const b64url = (v: Buffer | string): string => Buffer.from(v).toString('base64url');

/** Lit le compte de service fourni par l'environnement, s'il y en a un. */
export function compteServiceDe(env: Record<string, string | undefined>): CompteService | null {
  let brut = env.GCP_SERVICE_ACCOUNT_JSON?.trim();
  if (!brut && env.GOOGLE_APPLICATION_CREDENTIALS) brut = readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
  if (!brut) return null;
  // Le contenu peut être passé en base64 (variables d'environnement sur une seule ligne).
  const texte = brut.startsWith('{') ? brut : Buffer.from(brut, 'base64').toString('utf8');
  let c: Partial<CompteService>;
  try { c = JSON.parse(texte) as Partial<CompteService>; } catch { throw new Error('Compte de service Google illisible (JSON attendu)'); }
  if (!c.client_email || !c.private_key) throw new Error('Compte de service Google incomplet (client_email et private_key requis)');
  return c as CompteService;
}

/** Assertion signée (RS256) qu'un compte de service échange contre un jeton d'accès. */
export function assertionCompteService(c: CompteService, maintenantMs: number, portee = PORTEE): string {
  const iat = Math.floor(maintenantMs / 1000);
  const entete = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corps = b64url(JSON.stringify({ iss: c.client_email, scope: portee, aud: c.token_uri ?? 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${entete}.${corps}`).sign(c.private_key);
  return `${entete}.${corps}.${b64url(signature)}`;
}

export class AccesGoogle {
  private readonly env: Record<string, string | undefined>;
  private readonly recuperer: Recuperer;
  private readonly maintenant: () => number;
  private jetonCourant: { valeur: string; expire: number } | null = null;
  private enCours: Promise<string> | null = null;
  private projetConnu: string | null = null;

  constructor(o: OptionsAcces = {}) {
    this.env = o.env ?? process.env;
    this.recuperer = o.recuperer ?? ((url, init) => fetch(url, init));
    this.maintenant = o.maintenant ?? Date.now;
  }

  /** Jeton d'accès, gardé en mémoire jusqu'à une minute de son expiration. */
  async jeton(): Promise<string> {
    if (this.jetonCourant && this.jetonCourant.expire - 60_000 > this.maintenant()) return this.jetonCourant.valeur;
    // Une seule demande à la fois : dix requêtes simultanées n'en déclenchent pas dix.
    this.enCours ??= this.demanderJeton().finally(() => { this.enCours = null; });
    return this.enCours;
  }

  private async demanderJeton(): Promise<string> {
    const compte = compteServiceDe(this.env);
    let res: Response;
    if (compte) {
      res = await this.recuperer(compte.token_uri ?? 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertionCompteService(compte, this.maintenant()) }).toString(),
        signal: AbortSignal.timeout(8000),
      });
    } else {
      res = await this.recuperer(`${METADONNEES}/instance/service-accounts/default/token`, {
        headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(3000),
      });
    }
    if (!res.ok) throw new ErreurGoogle('Identification Google', res.status, (await res.text()).slice(0, 200));
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new ErreurGoogle('Identification Google', 502, 'réponse sans jeton');
    this.jetonCourant = { valeur: j.access_token, expire: this.maintenant() + (j.expires_in ?? 300) * 1000 };
    return j.access_token;
  }

  /** Identifiant du projet : GCP_PROJECT_ID, sinon celui du compte de service, sinon les métadonnées. */
  async projet(): Promise<string> {
    if (this.projetConnu) return this.projetConnu;
    let p = this.env.GCP_PROJECT_ID?.trim() || this.env.GOOGLE_CLOUD_PROJECT?.trim() || compteServiceDe(this.env)?.project_id;
    if (!p) {
      const res = await this.recuperer(`${METADONNEES}/project/project-id`, { headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new ErreurGoogle('Projet Google', res.status, 'identifiant du projet introuvable (définir GCP_PROJECT_ID)');
      p = (await res.text()).trim();
    }
    this.projetConnu = p;
    return p;
  }

  /** Appel JSON authentifié à une API Google. */
  async appel<T>(service: string, url: string, init: { method?: string; corps?: unknown } = {}): Promise<T> {
    const res = await this.recuperer(url, {
      method: init.method ?? (init.corps === undefined ? 'GET' : 'POST'),
      headers: { authorization: `Bearer ${await this.jeton()}`, ...(init.corps === undefined ? {} : { 'content-type': 'application/json' }) },
      body: init.corps === undefined ? undefined : JSON.stringify(init.corps),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      let message = res.statusText;
      try { message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message; } catch { /* corps non JSON */ }
      throw new ErreurGoogle(service, res.status, message.slice(0, 300));
    }
    return (await res.json()) as T;
  }
}
