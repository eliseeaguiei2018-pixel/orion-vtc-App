import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import type { Recuperer } from './acces.js';

/**
 * VÉRIFICATION DES JETONS SIGNÉS PAR GOOGLE (RS256).
 *
 * Sert à deux endroits : les jetons d'identité d'Identity Platform (un client qui a prouvé son
 * numéro auprès de Google) et le jeton que la passerelle API Gateway présente au serveur.
 * Les clés publiques de Google sont téléchargées puis gardées le temps indiqué par Google ;
 * elles tournent régulièrement, d'où le rechargement quand une clé inconnue se présente.
 */
export class JetonRefuse extends Error {
  constructor(readonly raison: string) { super(`Jeton refusé : ${raison}`); this.name = 'JetonRefuse'; }
}

export interface Revendications {
  iss?: string; aud?: string | string[]; sub?: string; exp?: number; iat?: number; auth_time?: number;
  email?: string; email_verified?: boolean; phone_number?: string;
  firebase?: { sign_in_provider?: string; tenant?: string };
  [cle: string]: unknown;
}

interface Jwk extends JsonWebKey { kid?: string; alg?: string }

export class ClesGoogle {
  private cles = new Map<string, Jwk>();
  private expire = 0;
  private dernierEssai = 0;

  constructor(private readonly url: string, private readonly recuperer: Recuperer = (u, i) => fetch(u, i), private readonly maintenant: () => number = Date.now) {}

  private async charger(): Promise<void> {
    const res = await this.recuperer(this.url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new JetonRefuse(`clés publiques de Google indisponibles (${res.status})`);
    const j = (await res.json()) as { keys?: Jwk[] };
    this.cles = new Map((j.keys ?? []).filter((k) => k.kid && k.kty === 'RSA').map((k) => [k.kid!, k]));
    const duree = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
    this.expire = this.maintenant() + Math.min(86_400, Math.max(300, Number(duree ?? 3600))) * 1000;
  }

  async cle(kid: string): Promise<Jwk> {
    if (this.maintenant() >= this.expire) await this.charger();
    let k = this.cles.get(kid);
    // Clé inconnue : Google vient peut-être d'en publier une nouvelle. Un rechargement par minute au plus.
    if (!k && this.maintenant() - this.dernierEssai > 60_000) {
      this.dernierEssai = this.maintenant();
      await this.charger();
      k = this.cles.get(kid);
    }
    if (!k) throw new JetonRefuse('clé de signature inconnue');
    return k;
  }
}

const decoder = (partie: string): unknown => JSON.parse(Buffer.from(partie, 'base64url').toString('utf8'));

/**
 * Vérifie la signature, l'émetteur, le destinataire et les dates d'un jeton.
 * `tolerance` : écart d'horloge accepté, en secondes.
 */
export async function verifierJetonGoogle(jeton: string, attendu: {
  cles: ClesGoogle; emetteurs: string[]; destinataires: string[]; maintenant?: () => number; tolerance?: number;
}): Promise<Revendications> {
  const parties = jeton.split('.');
  if (parties.length !== 3 || jeton.length > 4096) throw new JetonRefuse('format');
  let entete: { alg?: string; kid?: string };
  let corps: Revendications;
  try { entete = decoder(parties[0]!) as typeof entete; corps = decoder(parties[1]!) as Revendications; } catch { throw new JetonRefuse('format'); }
  // RS256 uniquement : « none » et les algorithmes symétriques sont refusés d'emblée.
  if (entete.alg !== 'RS256' || !entete.kid) throw new JetonRefuse('algorithme');
  const jwk = await attendu.cles.cle(entete.kid);
  const valide = verify('RSA-SHA256', Buffer.from(`${parties[0]}.${parties[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parties[2]!, 'base64url'));
  if (!valide) throw new JetonRefuse('signature');

  const t = Math.floor((attendu.maintenant ?? Date.now)() / 1000);
  const marge = attendu.tolerance ?? 60;
  if (typeof corps.exp !== 'number' || corps.exp + marge < t) throw new JetonRefuse('expiré');
  if (typeof corps.iat !== 'number' || corps.iat - marge > t) throw new JetonRefuse('date d’émission dans le futur');
  if (!corps.iss || !attendu.emetteurs.includes(corps.iss)) throw new JetonRefuse('émetteur');
  const aud = Array.isArray(corps.aud) ? corps.aud : [corps.aud ?? ''];
  if (!aud.some((a) => attendu.destinataires.includes(a))) throw new JetonRefuse('destinataire');
  if (!corps.sub || typeof corps.sub !== 'string') throw new JetonRefuse('sujet');
  return corps;
}
