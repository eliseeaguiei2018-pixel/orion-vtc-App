import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { Container } from '../../container.js';
import { config } from '../../config/index.js';
import { createRepository, type Repository } from '../../core/db/repository.js';

/**
 * TROUSSEAU DES CLÉS GOOGLE DU SERVEUR — clé principale + clés de secours.
 *
 * Toutes les clés d'un même projet Google ouvrent les mêmes services : les clés de secours
 * n'apportent rien de plus tant que la principale marche. Elles servent le jour où elle est
 * refusée (supprimée, régénérée, restreinte par erreur, bloquée) : le serveur passe tout seul à
 * la suivante, et la voix, la météo, le recalage GPS et les cartes ne s'arrêtent pas.
 *
 * Les clés de secours sont chiffrées en base (AES-256-GCM, clé dérivée du secret du serveur),
 * jamais renvoyées ni journalisées : la console n'en montre que les 4 derniers caractères.
 * Une clé refusée est mise de côté une heure par service, puis réessayée.
 */

interface Chiffre { iv: string; tag: string; data: string; fin: string }
interface EnregistrementSecours { id: 'secours'; cles: Chiffre[]; majLe: string; majPar: string }

const MISE_DE_COTE_MS = 3600_000;
export const FORMAT_CLE_GOOGLE = /^AIza[0-9A-Za-z_-]{35}$/;

export class TrousseauGoogle {
  private readonly depot: Repository<EnregistrementSecours> = createRepository<EnregistrementSecours>('cles_google_secours');
  private coffre: Buffer | null = null;
  private readonly refus = new Map<string, number>();

  constructor(private readonly env: Record<string, string | undefined> = process.env, private readonly maintenant: () => number = Date.now) {}

  private cleCoffre(): Buffer {
    this.coffre ??= scryptSync(`${config.ADMIN_JWT_SECRET}|${config.CLIENT_JWT_SECRET ?? ''}`, 'orion-cles-google-v1', 32);
    return this.coffre;
  }
  private chiffrer(v: string): Chiffre {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.cleCoffre(), iv);
    c.setAAD(Buffer.from('cle-google-secours'));
    const data = Buffer.concat([c.update(v, 'utf8'), c.final()]);
    return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64'), fin: v.slice(-4) };
  }
  private dechiffrer(e: Chiffre): string | null {
    try {
      const d = createDecipheriv('aes-256-gcm', this.cleCoffre(), Buffer.from(e.iv, 'base64'));
      d.setAAD(Buffer.from('cle-google-secours'));
      d.setAuthTag(Buffer.from(e.tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]).toString('utf8');
    } catch { return null; }
  }

  /** Clés de secours : celles de la console, puis GOOGLE_SERVER_API_KEYS_SECOURS (séparées par des virgules). */
  secours(): string[] {
    const console = (this.depot.get('secours')?.cles ?? []).map((e) => this.dechiffrer(e)).filter((v): v is string => Boolean(v));
    const variable = (this.env.GOOGLE_SERVER_API_KEYS_SECOURS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return [...new Set([...console, ...variable])];
  }

  /** Ajoute des clés (sans doublon) à celles déjà enregistrées. */
  ajouter(cles: string[], acteur: string): void {
    const deja = (this.depot.get('secours')?.cles ?? []).map((e) => this.dechiffrer(e)).filter((v): v is string => Boolean(v));
    this.enregistrer([...deja, ...cles], acteur);
  }
  /** Retire la clé de secours qui se termine par `fin` (4 caractères). */
  retirer(fin: string, acteur: string): boolean {
    const deja = (this.depot.get('secours')?.cles ?? []).map((e) => this.dechiffrer(e)).filter((v): v is string => Boolean(v));
    const reste = deja.filter((c) => c.slice(-4) !== fin);
    if (reste.length === deja.length) return false;
    this.enregistrer(reste, acteur);
    return true;
  }

  enregistrer(cles: string[], acteur: string): void {
    const uniques = [...new Set(cles.map((c) => c.trim()).filter(Boolean))];
    this.depot.put({ id: 'secours', cles: uniques.map((c) => this.chiffrer(c)), majLe: new Date(this.maintenant()).toISOString(), majPar: acteur });
    this.refus.clear();
  }

  /** Clés à essayer, dans l'ordre : la principale puis les secours, celles refusées récemment en dernier. */
  ordre(principale: string | null, service: string): string[] {
    const toutes = [...new Set([principale, ...this.secours()].filter((v): v is string => Boolean(v)))];
    const ok = toutes.filter((c) => !this.estRefusee(c, service));
    return ok.length ? [...ok, ...toutes.filter((c) => this.estRefusee(c, service))] : toutes;
  }

  marquerRefusee(cle: string, service: string): void { this.refus.set(`${service}:${cle}`, this.maintenant() + MISE_DE_COTE_MS); }
  estRefusee(cle: string, service: string): boolean { return (this.refus.get(`${service}:${cle}`) ?? 0) > this.maintenant(); }

  /** Pour la console : fin de chaque clé de secours et services où elle est mise de côté. */
  etat(): { secours: Array<{ fin: string; source: 'console' | 'variable'; refuseePour: string[] }>; majLe: string | null; majPar: string | null } {
    const e = this.depot.get('secours');
    const console = (e?.cles ?? []).map((c) => ({ cle: this.dechiffrer(c), fin: c.fin, source: 'console' as const }));
    const variable = (this.env.GOOGLE_SERVER_API_KEYS_SECOURS ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((c) => ({ cle: c, fin: c.slice(-4), source: 'variable' as const }));
    const services = [...new Set([...this.refus.keys()].map((k) => k.split(':')[0]!))];
    return {
      secours: [...console, ...variable].map((s) => ({ fin: s.fin, source: s.source, refuseePour: s.cle ? services.filter((sv) => this.estRefusee(s.cle!, sv)) : [] })),
      majLe: e?.majLe ?? null, majPar: e?.majPar ?? null,
    };
  }
}

/** La réponse de Google refuse-t-elle LA CLÉ (et non la demande) ? Alors une autre clé peut réussir. */
export function refusDeCle(statut: number, corps: string): boolean {
  if (statut === 401 || statut === 403) return true;
  if (/API key not valid|API_KEY_INVALID|API_KEY_EXPIRED|API_KEY_SERVICE_BLOCKED|key is invalid|expired/i.test(corps)) return true;
  return /"status"\s*:\s*"REQUEST_DENIED"/.test(corps);
}

const instances = new WeakMap<Container, TrousseauGoogle>();
export function trousseauGoogle(c: Container, o?: { env?: Record<string, string | undefined>; maintenant?: () => number }): TrousseauGoogle {
  let t = instances.get(c);
  if (!t || o) { t = new TrousseauGoogle(o?.env, o?.maintenant); instances.set(c, t); }
  return t;
}
