/**
 * CHAUFFEUR SALARIÉ — activité du mois et prime de performance.
 *
 * Les chauffeurs d'ORION sont salariés, payés au mois, sur des véhicules d'ORION : ni
 * commission ni gain par course. L'app montre ce qu'ils ont accompli et où ils en sont de
 * leur prime. Avec le serveur, tout vient de GET /drivers/:id/activite et /prime ; sans
 * serveur (démonstration), le même calcul est fait ici, avec la grille par défaut.
 */
export interface ActiviteMois {
  mois: string;
  courses: number;
  livraisons: number;
  km: number;
  /** Montant des courses réalisées (prix payé par les clients, encaissé pour ORION). */
  recettes: number;
  /** Espèces reçues des clients, à remettre à la caisse ORION. */
  especes: number;
  heuresService: number;
  joursActifs: number;
  note: { moyenne: number | null; nombre: number };
  offres: { recues: number; acceptees: number; refusees: number; expirees: number; tauxAcceptation: number | null };
  annulations: number;
  aujourdhui: { courses: number; km: number; recettes: number; heuresService: number };
  parJour: Array<{ jour: string; courses: number; km: number; heures: number }>;
}

export interface PrimeConfig {
  actif: boolean;
  paliers: Array<{ courses: number; montant: number }>;
  noteMin: number;
  tauxAcceptationMin: number;
  annulationsMax: number;
  bonusExcellence: { note: number; minNotes: number; montant: number };
  bonusAssiduite: { heures: number; montant: number };
}

export interface ConditionPrime { id: 'note' | 'acceptation' | 'annulations'; libelle: string; valeur: number | null; seuil: number; ok: boolean; enAttente: boolean }
export interface BonusPrime { id: 'excellence' | 'assiduite'; libelle: string; montant: number; acquis: boolean; progression: number; detail: string }
export interface PrimeMois {
  mois: string;
  actif: boolean;
  courses: number;
  paliers: PrimeConfig['paliers'];
  palier: { courses: number; montant: number } | null;
  prochain: { courses: number; montant: number; reste: number } | null;
  conditions: ConditionPrime[];
  bonus: BonusPrime[];
  montantEstime: number;
  montantMax: number;
  clos: boolean;
  activite: ActiviteMois;
}

/** Grille par défaut — identique à celle du serveur (settings/service.ts, DEFAULT_PRIME). */
export const GRILLE_PRIME_DEFAUT: PrimeConfig = {
  actif: true,
  paliers: [{ courses: 100, montant: 15_000 }, { courses: 160, montant: 30_000 }, { courses: 220, montant: 50_000 }],
  noteMin: 4.6,
  tauxAcceptationMin: 85,
  annulationsMax: 4,
  bonusExcellence: { note: 4.9, minNotes: 30, montant: 10_000 },
  bonusAssiduite: { heures: 200, montant: 10_000 },
};

export const moisCourant = (): string => new Date().toISOString().slice(0, 7);

/** « novembre 2026 » */
export function libelleMois(mois: string, langue = 'fr-FR'): string {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  try { return new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString(langue, { month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { return mois; }
}

/** Mois précédent / suivant (`AAAA-MM`). */
export function decalerMois(mois: string, n: number): string {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const fmtNote = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/** Même calcul que le serveur (driver-app/activite.ts, primeDuMois). */
export function calculerPrime(activite: ActiviteMois, grille: PrimeConfig = GRILLE_PRIME_DEFAUT): PrimeMois {
  const [a, m] = activite.mois.split('-').map(Number) as [number, number];
  const clos = Date.now() >= Date.UTC(a, m, 1);
  const paliers = [...grille.paliers].sort((x, y) => x.courses - y.courses);
  const atteints = paliers.filter((p) => activite.courses >= p.courses);
  const palier = atteints[atteints.length - 1] ?? null;
  const suivant = paliers.find((p) => activite.courses < p.courses);
  const conditions: ConditionPrime[] = [];
  if (grille.noteMin > 0) {
    const v = activite.note.moyenne;
    conditions.push({ id: 'note', libelle: `Note moyenne d'au moins ${fmtNote(grille.noteMin)}`, valeur: v, seuil: grille.noteMin, ok: v === null || v >= grille.noteMin, enAttente: v === null });
  }
  if (grille.tauxAcceptationMin > 0) {
    const v = activite.offres.tauxAcceptation;
    conditions.push({ id: 'acceptation', libelle: `Au moins ${grille.tauxAcceptationMin} % d'offres acceptées`, valeur: v, seuil: grille.tauxAcceptationMin, ok: v === null || v >= grille.tauxAcceptationMin, enAttente: v === null });
  }
  conditions.push({ id: 'annulations', libelle: `${grille.annulationsMax} annulation${grille.annulationsMax > 1 ? 's' : ''} au plus`, valeur: activite.annulations, seuil: grille.annulationsMax, ok: activite.annulations <= grille.annulationsMax, enAttente: false });
  const bonus: BonusPrime[] = [];
  const be = grille.bonusExcellence, ba = grille.bonusAssiduite;
  if (be.montant > 0) {
    const n = activite.note;
    bonus.push({
      id: 'excellence', libelle: 'Bonus excellence', montant: be.montant,
      acquis: n.moyenne !== null && n.moyenne >= be.note && n.nombre >= be.minNotes,
      progression: be.minNotes > 0 ? Math.min(1, n.nombre / be.minNotes) : 1,
      detail: `Note d'au moins ${fmtNote(be.note)} sur ${be.minNotes} notes ou plus (${n.nombre} note${n.nombre > 1 ? 's' : ''}${n.moyenne !== null ? `, ${fmtNote(n.moyenne)}` : ''})`,
    });
  }
  if (ba.montant > 0) {
    const h = activite.heuresService;
    bonus.push({
      id: 'assiduite', libelle: 'Bonus assiduité', montant: ba.montant, acquis: h >= ba.heures,
      progression: ba.heures > 0 ? Math.min(1, h / ba.heures) : 1,
      detail: `${ba.heures} h en service dans le mois (${h.toLocaleString('fr-FR')} h)`,
    });
  }
  const tenues = conditions.every((c) => c.ok);
  const montantEstime = !grille.actif || !tenues ? 0 : (palier?.montant ?? 0) + bonus.filter((b) => b.acquis).reduce((s, b) => s + b.montant, 0);
  const montantMax = !grille.actif ? 0 : (paliers[paliers.length - 1]?.montant ?? 0) + bonus.reduce((s, b) => s + b.montant, 0);
  return {
    mois: activite.mois, actif: grille.actif, courses: activite.courses, paliers, palier,
    prochain: suivant ? { ...suivant, reste: suivant.courses - activite.courses } : null,
    conditions, bonus, montantEstime, montantMax, clos, activite,
  };
}
