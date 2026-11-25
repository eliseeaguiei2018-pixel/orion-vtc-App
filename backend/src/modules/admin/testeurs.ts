import { randomInt } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * ACCÈS TESTEURS : se connecter sans SMS, sur invitation de la direction.
 *
 * Tant qu'aucun opérateur SMS ou WhatsApp n'est branché, la direction ajoute dans la console
 * le numéro d'un testeur (client ou chauffeur). Le serveur lui attribue un code à 6 chiffres,
 * que la direction lui transmet elle-même. Ce numéro-là, et lui seul, se connecte avec ce
 * code à la place du code SMS. Tout autre numéro reste soumis au code SMS.
 *
 * - le code n'ouvre QUE le compte du numéro invité (il ne vaut rien pour un autre numéro) ;
 * - il expire (7 jours par défaut, 30 au plus) et la direction peut le retirer à tout moment ;
 * - chaque utilisation est comptée et datée, chaque invitation inscrite au journal d'audit.
 */
export interface AccesTesteur {
  /** Le numéro, au format +225… (identifiant de l'invitation). */
  id: string;
  phone: string;
  nom: string;
  code: string;
  creeLe: string;
  creePar: string;
  expireLe: string;
  utilisations: number;
  derniereUtilisation: string | null;
}

export const JOURS_PAR_DEFAUT = 7;
export const JOURS_MAX = 30;

export class AccesTesteurs {
  private readonly parNumero = new Map<string, AccesTesteur>();

  constructor(private readonly repo: Repository<AccesTesteur>, private readonly maintenant: () => number = Date.now) {
    for (const a of repo.all()) this.parNumero.set(a.id, a);
  }

  /** Invitations, de la plus récente à la plus ancienne, avec leur état. */
  liste(): Array<AccesTesteur & { actif: boolean }> {
    const t = this.maintenant();
    return [...this.parNumero.values()]
      .map((a) => ({ ...a, actif: Date.parse(a.expireLe) > t }))
      .sort((a, b) => b.creeLe.localeCompare(a.creeLe));
  }

  /** Invite un numéro (ou lui donne un nouveau code) : l'ancien code ne vaut plus rien. */
  inviter(o: { phone: string; nom: string; jours?: number; par: string }): AccesTesteur {
    const jours = Math.min(JOURS_MAX, Math.max(1, Math.round(o.jours ?? JOURS_PAR_DEFAUT)));
    const t = this.maintenant();
    const acces: AccesTesteur = {
      id: o.phone, phone: o.phone, nom: o.nom.trim(),
      code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      creeLe: new Date(t).toISOString(), creePar: o.par,
      expireLe: new Date(t + jours * 86_400_000).toISOString(),
      utilisations: 0, derniereUtilisation: null,
    };
    this.parNumero.set(acces.id, acces);
    this.repo.put(acces);
    return acces;
  }

  retirer(phone: string): boolean {
    if (!this.parNumero.delete(phone)) return false;
    this.repo.delete(phone);
    return true;
  }

  /** Code d'accès en cours de validité pour CE numéro, sinon `undefined`. */
  codePour(phone: string): string | undefined {
    const a = this.parNumero.get(phone);
    return a && Date.parse(a.expireLe) > this.maintenant() ? a.code : undefined;
  }

  noterUtilisation(phone: string): void {
    const a = this.parNumero.get(phone);
    if (!a) return;
    const maj = { ...a, utilisations: a.utilisations + 1, derniereUtilisation: new Date(this.maintenant()).toISOString() };
    this.parNumero.set(phone, maj);
    this.repo.put(maj);
  }
}
