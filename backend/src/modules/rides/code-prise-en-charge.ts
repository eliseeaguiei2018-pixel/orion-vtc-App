import { randomInt } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * CODE DE PRISE EN CHARGE (4 chiffres).
 *
 * À la commande d'une course, ORION tire un code que seul le passager voit dans son app.
 * À la prise en charge, le passager le donne au chauffeur, qui le saisit dans l'app
 * chauffeur : la course ne démarre qu'avec le bon code. On s'assure ainsi que le
 * chauffeur embarque la bonne personne, et que la personne monte dans le bon véhicule.
 *
 * Le code est rangé À PART de la course : une course circule partout (console, tableau de
 * bord, app chauffeur, historique) et le code ne doit fuiter par aucune de ces routes.
 * Cinq erreurs bloquent la saisie : quatre chiffres se devinent, cinq essais non.
 */
export interface CodeCourse {
  /** Identifiant de la course. */
  id: string;
  code: string;
  essais: number;
  verifieLe?: string;
  /** Vérifié par l'app chauffeur, ou par le simulateur en développement. */
  par?: 'chauffeur' | 'simulation';
  bloqueLe?: string;
}

export const MAX_ESSAIS = 5;

export type ResultatCode =
  | { ok: true }
  | { ok: false; raison: 'absent' | 'deja_verifie' | 'bloque' }
  | { ok: false; raison: 'faux'; essaisRestants: number; bloque: boolean };

/** Codes trop faciles à deviner ou à dire de travers : jamais tirés. */
const EVITES = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123']);

export class CodesPriseEnCharge {
  private readonly codes = new Map<string, CodeCourse>();

  constructor(private readonly repo?: Repository<CodeCourse>) {
    for (const c of repo?.all() ?? []) this.codes.set(c.id, c);
  }

  private garder(c: CodeCourse): CodeCourse {
    this.codes.set(c.id, c);
    this.repo?.put(c);
    return c;
  }

  creer(rideId: string): string {
    let code = '';
    do code = String(randomInt(0, 10_000)).padStart(4, '0'); while (EVITES.has(code));
    this.garder({ id: rideId, code, essais: 0 });
    return code;
  }

  lire(rideId: string): CodeCourse | undefined {
    const c = this.codes.get(rideId);
    return c ? { ...c } : undefined;
  }

  /** La course attend-elle encore son code pour démarrer ? */
  requis(rideId: string): boolean {
    const c = this.codes.get(rideId);
    return Boolean(c && !c.verifieLe);
  }

  verifier(rideId: string, saisi: string): ResultatCode {
    const c = this.codes.get(rideId);
    if (!c) return { ok: false, raison: 'absent' };
    if (c.verifieLe) return { ok: false, raison: 'deja_verifie' };
    if (c.bloqueLe) return { ok: false, raison: 'bloque' };
    if (saisi.trim() === c.code) {
      c.verifieLe = new Date().toISOString();
      c.par = 'chauffeur';
      this.garder(c);
      return { ok: true };
    }
    c.essais += 1;
    const bloque = c.essais >= MAX_ESSAIS;
    if (bloque) c.bloqueLe = new Date().toISOString();
    this.garder(c);
    return { ok: false, raison: 'faux', essaisRestants: Math.max(0, MAX_ESSAIS - c.essais), bloque };
  }

  /** Développement : le simulateur tient le rôle du chauffeur qui saisit le code. */
  marquerSimule(rideId: string): void {
    const c = this.codes.get(rideId);
    if (!c || c.verifieLe) return;
    c.verifieLe = new Date().toISOString();
    c.par = 'simulation';
    this.garder(c);
  }

  /** La supervision débloque après avoir joint le passager (nouveau code, essais remis à zéro). */
  renouveler(rideId: string): string | null {
    if (!this.codes.has(rideId)) return null;
    return this.creer(rideId);
  }
}
