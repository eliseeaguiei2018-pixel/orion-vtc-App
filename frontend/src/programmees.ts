/**
 * Courses programmées (« Plus tard »).
 *
 * Le client choisit une date et une heure ; la course est enregistrée sur le serveur ORION
 * quand il est joint (la console suit ce calendrier et affecte un chauffeur), et dans tous
 * les cas gardée sur le téléphone pour être relue et annulée depuis « Mes courses ».
 * Une course dont l'heure est passée depuis plus de deux heures sort de la liste.
 */
import { reserverCourse } from './api';
import type { Place } from './types';

const CLE = 'orion.programmees';

export interface CourseProgrammee {
  id: string;
  origine: { nom: string; lat: number; lng: number };
  destination: { nom: string; lat: number; lng: number };
  gamme: string;
  /** Heure de prise en charge prévue (ISO). */
  quand: string;
  /** Prix affiché à la confirmation, s'il était connu. */
  montant: number | null;
  /** Vrai si le serveur ORION l'a enregistrée ; faux si elle n'est que sur le téléphone. */
  serveur: boolean;
  creeLe: string;
}

const lire = (): CourseProgrammee[] => {
  try {
    const v = JSON.parse(localStorage.getItem(CLE) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as CourseProgrammee[]) : [];
  } catch { return []; }
};
const ecrire = (l: CourseProgrammee[]) => { try { localStorage.setItem(CLE, JSON.stringify(l.slice(0, 20))); } catch { /* stockage indisponible */ } };

/** Les courses à venir, la plus proche d'abord. */
export function coursesProgrammees(): CourseProgrammee[] {
  const limite = Date.now() - 2 * 3_600_000;
  return lire().filter((c) => Date.parse(c.quand) > limite).sort((a, b) => Date.parse(a.quand) - Date.parse(b.quand));
}

export async function programmerCourse(x: { origine: Place; destination: Place; gamme: string; quand: string; montant: number | null }): Promise<CourseProgrammee> {
  const c: CourseProgrammee = {
    id: `prog-${Date.now().toString(36)}`,
    origine: { nom: x.origine.name, ...x.origine.location },
    destination: { nom: x.destination.name, ...x.destination.location },
    gamme: x.gamme, quand: x.quand, montant: x.montant, serveur: false, creeLe: new Date().toISOString(),
  };
  ecrire([c, ...lire()]);
  const id = await reserverCourse({ origin: x.origine.location, destination: x.destination.location, category: x.gamme, scheduledFor: x.quand }).catch(() => null);
  if (id) ecrire(lire().map((p) => (p.id === c.id ? { ...p, id, serveur: true } : p)));
  return c;
}

export function annulerProgrammee(id: string): void {
  ecrire(lire().filter((c) => c.id !== id));
}

/** Valeur d'un champ datetime-local (heure du téléphone) pour un instant donné. */
export function heureLocale(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

/** « sam. 22 nov., 08:30 » dans la langue du téléphone. */
export function libelleQuand(iso: string, langue?: string): string {
  try {
    return new Date(iso).toLocaleString(langue, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}
