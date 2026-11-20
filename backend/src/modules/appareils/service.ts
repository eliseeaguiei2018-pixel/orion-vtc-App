import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';
import { verifierCodeSynchro } from './code.js';

/**
 * APPAREILS DE CONFIANCE : chaque ordinateur, tablette ou téléphone qui ouvre la console
 * ou le tableau de bord est enrôlé UNE fois avec le code de synchronisation ORION.
 *
 * Le code n'est pas un mot de passe : il dit « cet appareil appartient à ORION ». Chaque
 * employé se connecte ensuite avec SON identifiant et SON mot de passe (et son code à
 * usage unique pour la direction). Un appareil perdu ou volé se révoque en un clic dans
 * la console, sans changer le code de tout le monde.
 *
 * L'appareil reçoit une clé aléatoire (256 bits) dont le serveur ne garde que l'empreinte
 * SHA-256 : une fuite de la base ne permet pas de se faire passer pour un appareil.
 */
export type Plateforme = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'harmonyos' | 'web';
export type ApplicationOrion = 'console' | 'tableau' | 'chauffeur';

export interface Appareil {
  id: string;
  nom: string;
  plateforme: Plateforme;
  application: ApplicationOrion;
  /** SHA-256 de la clé de l'appareil (la clé elle-même n'est jamais conservée). */
  empreinteCle: string;
  enroleLe: string;
  ipEnrolement?: string;
  derniereActivite?: string;
  dernierCompte?: string;
  derniereIp?: string;
  revoqueLe?: string;
  revoquePar?: string;
}

export type AppareilPublic = Omit<Appareil, 'empreinteCle'> & { actif: boolean };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const QUART_HEURE = 15 * 60_000;
/** Essais manqués tolérés par adresse IP sur un quart d'heure. */
export const ESSAIS_PAR_IP = 5;
/** Essais manqués tolérés tous appareils confondus (attaque répartie) sur un quart d'heure. */
export const ESSAIS_GLOBAUX = 50;

export class CodeSynchroRefuse extends Error {
  constructor(readonly raison: 'non_configure' | 'trop_d_essais' | 'code_invalide', readonly attenteSecondes = 0) {
    super(raison);
  }
}

export class AppareilsService {
  private readonly appareils = new Map<string, Appareil>();
  private readonly parCle = new Map<string, string>();
  private readonly echecsParIp = new Map<string, number[]>();
  private echecsGlobaux: number[] = [];

  constructor(private readonly empreinteCode: () => string | undefined, private readonly repo?: Repository<Appareil>) {
    for (const a of repo?.all() ?? []) this.indexer(a);
  }

  private indexer(a: Appareil): void {
    this.appareils.set(a.id, a);
    this.parCle.set(a.empreinteCle, a.id);
  }

  get configure(): boolean {
    return Boolean(this.empreinteCode());
  }

  private recents(liste: number[], maintenant: number): number[] {
    return liste.filter((t) => maintenant - t < QUART_HEURE);
  }

  /** Enrôle un appareil si le code est bon. Renvoie l'appareil et SA clé (remise une seule fois). */
  async enroler(code: string, infos: { nom: string; plateforme: Plateforme; application: ApplicationOrion }, ip: string): Promise<{ appareil: AppareilPublic; cle: string }> {
    const empreinte = this.empreinteCode();
    if (!empreinte) throw new CodeSynchroRefuse('non_configure');
    const maintenant = Date.now();
    const parIp = this.recents(this.echecsParIp.get(ip) ?? [], maintenant);
    this.echecsGlobaux = this.recents(this.echecsGlobaux, maintenant);
    if (parIp.length >= ESSAIS_PAR_IP || this.echecsGlobaux.length >= ESSAIS_GLOBAUX) {
      const plusAncien = Math.min(...(parIp.length >= ESSAIS_PAR_IP ? parIp : this.echecsGlobaux));
      throw new CodeSynchroRefuse('trop_d_essais', Math.ceil((plusAncien + QUART_HEURE - maintenant) / 1000));
    }
    if (!(await verifierCodeSynchro(code, empreinte))) {
      parIp.push(maintenant);
      this.echecsParIp.set(ip, parIp);
      this.echecsGlobaux.push(maintenant);
      throw new CodeSynchroRefuse('code_invalide');
    }
    this.echecsParIp.delete(ip);
    const cle = randomBytes(32).toString('base64url');
    const appareil: Appareil = {
      id: randomUUID(), nom: infos.nom, plateforme: infos.plateforme, application: infos.application,
      empreinteCle: sha256(cle), enroleLe: new Date().toISOString(), ipEnrolement: ip,
    };
    this.indexer(appareil);
    this.repo?.put(appareil);
    return { appareil: this.vue(appareil), cle };
  }

  /** L'appareil qui présente cette clé, s'il est enrôlé et non révoqué. */
  parSaCle(cle: string | undefined): Appareil | undefined {
    if (!cle) return undefined;
    const a = this.appareils.get(this.parCle.get(sha256(cle)) ?? '');
    return a && !a.revoqueLe ? a : undefined;
  }

  /** Trace d'activité (écrite au plus une fois par minute et par appareil). */
  toucher(a: Appareil, ip: string, compte?: string): void {
    const avant = a.derniereActivite ? Date.parse(a.derniereActivite) : 0;
    a.derniereIp = ip;
    if (compte) a.dernierCompte = compte;
    if (Date.now() - avant < 60_000) return;
    a.derniereActivite = new Date().toISOString();
    this.repo?.put(a);
  }

  revoquer(id: string, par: string): AppareilPublic | undefined {
    const a = this.appareils.get(id);
    if (!a) return undefined;
    if (!a.revoqueLe) {
      a.revoqueLe = new Date().toISOString();
      a.revoquePar = par;
      this.repo?.put(a);
    }
    return this.vue(a);
  }

  liste(): AppareilPublic[] {
    return [...this.appareils.values()].reverse().map((a) => this.vue(a));
  }

  vue(a: Appareil): AppareilPublic {
    const { empreinteCle: _cle, ...reste } = a;
    return { ...reste, actif: !a.revoqueLe };
  }
}
