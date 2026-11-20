import { randomInt } from 'node:crypto';
import { issueDriverToken } from './auth.js';

/**
 * APPAIRAGE TÉLÉPHONE ↔ ÉCRAN DE VÉHICULE.
 *
 * Le chauffeur est déjà connecté sur SON téléphone. Pour ouvrir l'app Chauffeur sur
 * l'écran large de la voiture (Android Automotive, CarPlay web, écran embarqué du
 * constructeur), il demande un code à six chiffres depuis son téléphone et le saisit sur
 * l'écran de la voiture. L'écran obtient alors une session chauffeur, sans jamais taper
 * d'identifiant ni de mot de passe sur un écran partagé.
 *
 * Sécurité : le code est à usage unique, valable trois minutes, et lié au chauffeur qui
 * l'a demandé (jamais à un autre). Un seul code actif par chauffeur. L'échange est limité
 * en nombre d'essais, par adresse et globalement, pour qu'on ne puisse pas deviner un code
 * par force brute. Tout est journalisé.
 */
export interface AppairageVehicule {
  code: string;
  driverId: string;
  creeLe: number;
  expireLe: number;
  essais: number;
}

const DUREE_MS = 3 * 60_000;
const MAX_ESSAIS_CODE = 5;
/** Essais d'échange tolérés par adresse, puis globalement, sur trois minutes. */
export const ESSAIS_PAR_IP = 10;
export const ESSAIS_GLOBAUX = 60;

export class AppairageRefuse extends Error {
  constructor(readonly raison: 'code_invalide' | 'trop_d_essais', readonly attenteSecondes = 0) {
    super(raison);
  }
}

export class AppairageVehicules {
  private readonly parChauffeur = new Map<string, AppairageVehicule>();
  private readonly parCode = new Map<string, string>();
  private readonly echecsParIp = new Map<string, number[]>();
  private echecsGlobaux: number[] = [];

  constructor(private readonly ttlSecondesJeton = 0) {}

  private purger(maintenant: number): void {
    for (const [code, driverId] of this.parCode) {
      const a = this.parChauffeur.get(driverId);
      if (!a || a.code !== code || a.expireLe <= maintenant) {
        this.parCode.delete(code);
        if (a && a.expireLe <= maintenant) this.parChauffeur.delete(driverId);
      }
    }
  }

  /** Le chauffeur (déjà connecté) demande un code pour appairer un écran de véhicule. */
  creer(driverId: string): { code: string; expireLe: string; dureeSecondes: number } {
    const maintenant = Date.now();
    this.purger(maintenant);
    // Remplace un éventuel code en cours (un seul écran en attente d'appairage à la fois).
    const ancien = this.parChauffeur.get(driverId);
    if (ancien) this.parCode.delete(ancien.code);
    let code = '';
    do { code = String(randomInt(0, 1_000_000)).padStart(6, '0'); } while (this.parCode.has(code));
    const a: AppairageVehicule = { code, driverId, creeLe: maintenant, expireLe: maintenant + DUREE_MS, essais: 0 };
    this.parChauffeur.set(driverId, a);
    this.parCode.set(code, driverId);
    return { code, expireLe: new Date(a.expireLe).toISOString(), dureeSecondes: Math.round(DUREE_MS / 1000) };
  }

  private recents(liste: number[], maintenant: number): number[] {
    return liste.filter((t) => maintenant - t < DUREE_MS);
  }

  /**
   * L'écran du véhicule présente le code. Si le code est bon, l'écran obtient une session
   * chauffeur. Le code est aussitôt consommé.
   */
  echanger(codeSaisi: string, ip: string): { token: string; expiresAt: string; driverId: string } {
    const maintenant = Date.now();
    this.purger(maintenant);
    const parIp = this.recents(this.echecsParIp.get(ip) ?? [], maintenant);
    this.echecsGlobaux = this.recents(this.echecsGlobaux, maintenant);
    if (parIp.length >= ESSAIS_PAR_IP || this.echecsGlobaux.length >= ESSAIS_GLOBAUX) {
      const base = parIp.length >= ESSAIS_PAR_IP ? parIp : this.echecsGlobaux;
      throw new AppairageRefuse('trop_d_essais', Math.ceil((Math.min(...base) + DUREE_MS - maintenant) / 1000));
    }
    const code = codeSaisi.replace(/\s/g, '');
    const driverId = this.parCode.get(code);
    const a = driverId ? this.parChauffeur.get(driverId) : undefined;
    const mauvais = () => {
      parIp.push(maintenant);
      this.echecsParIp.set(ip, parIp);
      this.echecsGlobaux.push(maintenant);
    };
    if (!a || a.expireLe <= maintenant) { mauvais(); throw new AppairageRefuse('code_invalide'); }
    a.essais += 1;
    if (a.essais > MAX_ESSAIS_CODE) { this.oublier(a.driverId); mauvais(); throw new AppairageRefuse('code_invalide'); }
    // Succès : le code est consommé, l'écran reçoit une session chauffeur.
    this.oublier(a.driverId);
    this.echecsParIp.delete(ip);
    const { token, expiresAt } = issueDriverToken(a.driverId);
    return { token, expiresAt, driverId: a.driverId };
  }

  /** Le chauffeur annule l'appairage en cours (depuis son téléphone). */
  oublier(driverId: string): void {
    const a = this.parChauffeur.get(driverId);
    if (a) this.parCode.delete(a.code);
    this.parChauffeur.delete(driverId);
  }
}
