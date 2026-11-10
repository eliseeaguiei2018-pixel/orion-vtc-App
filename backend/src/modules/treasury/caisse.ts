import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * CAISSE NOMINATIVE — le poste de travail d'une trésorière ORION.
 *
 * Une partie de l'argent d'ORION arrive en espèces : un chauffeur vient régler la
 * commission des courses qu'il a encaissées en liquide, un client paye une location
 * au comptoir, un reliquat de note de frais revient. Cet argent transite par les
 * mains d'une personne, et le compte se fait à la main, en fin de journée, billet
 * par billet.
 *
 * Le logiciel ne doit pas faire semblant que cette étape n'existe pas. Tant qu'elle
 * n'est pas outillée, elle se fait sur un cahier, et le rapport financier de
 * l'entreprise ignore une part réelle de ses encaissements.
 *
 * PRINCIPE COMPTABLE : la caisse est NOMINATIVE. Une trésorière ouvre SA caisse avec
 * un fond de caisse, y enregistre ce qu'elle reçoit, et la ferme en comptant
 * physiquement. L'écart entre le compté et l'attendu n'est jamais effacé : il est
 * constaté, justifié, et il suit la personne. Une caisse qui tombe toujours juste au
 * centime près est une caisse qu'on n'a pas comptée.
 *
 * Personne ne touche la caisse d'une autre : la portée est imposée côté serveur.
 */

/** Coupures du franc CFA (BCEAO), de la plus grosse à la plus petite. */
export const COUPURES = [10_000, 5_000, 2_000, 1_000, 500, 250, 200, 100, 50, 25, 10, 5] as const;
export type Coupure = (typeof COUPURES)[number];

/** Au-delà de cet écart, un motif écrit est obligatoire pour clôturer. */
export const ECART_TOLERE = 500;

export type OrigineEncaissement =
  | 'commission_chauffeur'  // dette espèces réglée par un chauffeur
  | 'location'              // location réglée au comptoir
  | 'abonnement'
  | 'reliquat_note_frais'
  | 'remboursement_pret'
  | 'autre';

export type SortieCaisse =
  | 'versement_banque'      // la caisse part à la banque
  | 'avance_chauffeur'      // prêt ou avance remis en liquide
  | 'depense'               // petite dépense réglée de la caisse
  | 'transfert_caisse';     // passage de main à une autre trésorière

export const ORIGINE_LABEL: Record<OrigineEncaissement, string> = {
  commission_chauffeur: 'Commission chauffeur (espèces)',
  location: 'Location Signature',
  abonnement: 'Abonnement ORION',
  reliquat_note_frais: 'Reliquat de note de frais',
  remboursement_pret: 'Remboursement de prêt',
  autre: 'Autre encaissement',
};

export const SORTIE_LABEL: Record<SortieCaisse, string> = {
  versement_banque: 'Versement en banque',
  avance_chauffeur: 'Avance / prêt remis en espèces',
  depense: 'Dépense réglée en caisse',
  transfert_caisse: 'Transfert à une autre caisse',
};

export interface MouvementCaisse {
  id: string;
  caisseId: string;
  sens: 'entree' | 'sortie';
  montant: number;
  origine?: OrigineEncaissement;
  sortie?: SortieCaisse;
  /** À qui l'argent a été pris ou remis — nom lisible, pas un identifiant. */
  tiers?: string;
  /** Référence du dossier à l'origine du mouvement (chauffeur, location, requête). */
  reference?: string;
  note?: string;
  at: string;
  par: string;
}

/** Comptage physique : combien de billets et de pièces de chaque coupure. */
export type Comptage = Partial<Record<Coupure, number>>;

export interface Caisse {
  id: string;
  /** Identifiant de connexion de la trésorière — la caisse est nominative. */
  titulaire: string;
  titulaireNom: string;
  /** Point de tenue : siège, agence Cocody, comptoir aéroport… */
  emplacement?: string;
  statut: 'ouverte' | 'arretee';
  fondDeCaisse: number;
  ouverteLe: string;
  arreteeLe?: string;
  /* --- Arrêté de caisse --- */
  comptage?: Comptage;
  /** Somme réellement comptée (dérivée du comptage, ou saisie directe). */
  montantCompte?: number;
  /** Ce que les mouvements disent qu'il devrait y avoir. */
  montantAttendu?: number;
  /** compté − attendu. Négatif = manquant, positif = excédent. */
  ecart?: number;
  motifEcart?: string;
  /** Part de l'arrêté effectivement versée en banque. */
  verseEnBanque?: number;
  /** Validation par un supérieur : un arrêté ne se valide pas tout seul. */
  valideLe?: string;
  validePar?: string;
}

export interface EtatCaisse extends Caisse {
  mouvements: MouvementCaisse[];
  entrees: number;
  sorties: number;
  /** Fond de caisse + entrées − sorties : ce qui devrait être dans le tiroir. */
  soldeTheorique: number;
  parOrigine: Record<string, number>;
}

/** Total d'un comptage par coupures. */
export function totalComptage(c: Comptage): number {
  let total = 0;
  for (const coupure of COUPURES) total += (c[coupure] ?? 0) * coupure;
  return total;
}

export class CaisseService {
  private readonly caisses = new Map<string, Caisse>();
  private readonly mouvements = new Map<string, MouvementCaisse[]>();

  constructor(
    private readonly repoCaisses?: Repository<Caisse>,
    private readonly repoMouvements?: Repository<MouvementCaisse>,
  ) {
    for (const c of repoCaisses?.all() ?? []) this.caisses.set(c.id, c);
    for (const m of repoMouvements?.all() ?? []) {
      const liste = this.mouvements.get(m.caisseId) ?? [];
      liste.push(m);
      this.mouvements.set(m.caisseId, liste);
    }
  }

  /** La caisse ouverte d'une trésorière, s'il y en a une. */
  caisseOuverteDe(titulaire: string): Caisse | undefined {
    for (const c of this.caisses.values()) {
      if (c.titulaire === titulaire && c.statut === 'ouverte') return c;
    }
    return undefined;
  }

  /**
   * Ouvre une caisse. Une seule caisse ouverte par personne : deux tiroirs
   * simultanés au même nom et plus personne ne sait où est l'argent.
   */
  ouvrir(input: { titulaire: string; titulaireNom: string; fondDeCaisse: number; emplacement?: string }): Caisse | 'deja_ouverte' {
    if (this.caisseOuverteDe(input.titulaire)) return 'deja_ouverte';
    const c: Caisse = {
      id: randomUUID().slice(0, 8),
      titulaire: input.titulaire,
      titulaireNom: input.titulaireNom,
      emplacement: input.emplacement,
      statut: 'ouverte',
      fondDeCaisse: Math.max(0, Math.round(input.fondDeCaisse)),
      ouverteLe: new Date().toISOString(),
    };
    this.caisses.set(c.id, c);
    this.repoCaisses?.put(c);
    return c;
  }

  private ajouter(m: MouvementCaisse): MouvementCaisse {
    const liste = this.mouvements.get(m.caisseId) ?? [];
    liste.push(m);
    this.mouvements.set(m.caisseId, liste);
    this.repoMouvements?.put(m);
    return m;
  }

  encaisser(caisseId: string, input: {
    montant: number; origine: OrigineEncaissement; tiers?: string; reference?: string; note?: string; par: string;
  }): MouvementCaisse | 'caisse_fermee' | null {
    const c = this.caisses.get(caisseId);
    if (!c) return null;
    if (c.statut !== 'ouverte') return 'caisse_fermee';
    return this.ajouter({
      id: randomUUID().slice(0, 8), caisseId, sens: 'entree',
      montant: Math.max(0, Math.round(input.montant)),
      origine: input.origine, tiers: input.tiers, reference: input.reference, note: input.note,
      at: new Date().toISOString(), par: input.par,
    });
  }

  /**
   * Sortie d'espèces. On refuse de sortir plus que ce que le tiroir contient :
   * une caisse négative n'existe pas dans le monde réel, et l'accepter à l'écran
   * revient à masquer une erreur de saisie jusqu'à l'arrêté.
   */
  decaisser(caisseId: string, input: {
    montant: number; sortie: SortieCaisse; tiers?: string; reference?: string; note?: string; par: string;
  }): MouvementCaisse | 'caisse_fermee' | 'solde_insuffisant' | null {
    const c = this.caisses.get(caisseId);
    if (!c) return null;
    if (c.statut !== 'ouverte') return 'caisse_fermee';
    const montant = Math.max(0, Math.round(input.montant));
    if (montant > this.soldeTheorique(caisseId)) return 'solde_insuffisant';
    return this.ajouter({
      id: randomUUID().slice(0, 8), caisseId, sens: 'sortie', montant,
      sortie: input.sortie, tiers: input.tiers, reference: input.reference, note: input.note,
      at: new Date().toISOString(), par: input.par,
    });
  }

  soldeTheorique(caisseId: string): number {
    const c = this.caisses.get(caisseId);
    if (!c) return 0;
    let solde = c.fondDeCaisse;
    for (const m of this.mouvements.get(caisseId) ?? []) {
      solde += m.sens === 'entree' ? m.montant : -m.montant;
    }
    return solde;
  }

  /**
   * ARRÊTÉ DE CAISSE : la trésorière compte physiquement et déclare ce qu'elle a.
   * L'écart n'est pas corrigé en silence — il est constaté. Au-delà de la tolérance,
   * un motif écrit est obligatoire : un manquant de 20 000 F sans explication n'est
   * pas un arrêté, c'est un trou.
   */
  arreter(caisseId: string, input: {
    comptage?: Comptage; montantCompte?: number; motifEcart?: string; verseEnBanque?: number; par: string;
  }): Caisse | 'deja_arretee' | 'motif_requis' | 'rien_a_compter' | null {
    const c = this.caisses.get(caisseId);
    if (!c) return null;
    if (c.statut !== 'ouverte') return 'deja_arretee';

    const compte = input.comptage ? totalComptage(input.comptage) : input.montantCompte;
    if (compte === undefined) return 'rien_a_compter';

    const attendu = this.soldeTheorique(caisseId);
    const ecart = compte - attendu;
    if (Math.abs(ecart) > ECART_TOLERE && !input.motifEcart?.trim()) return 'motif_requis';

    c.comptage = input.comptage;
    c.montantCompte = compte;
    c.montantAttendu = attendu;
    c.ecart = ecart;
    c.motifEcart = input.motifEcart?.trim() || undefined;
    c.verseEnBanque = input.verseEnBanque !== undefined ? Math.max(0, Math.round(input.verseEnBanque)) : undefined;
    c.statut = 'arretee';
    c.arreteeLe = new Date().toISOString();
    this.repoCaisses?.put(c);

    // Le versement en banque est un mouvement comme un autre : il doit figurer au
    // journal de la caisse, sinon l'arrêté suivant repart d'un solde faux.
    if (c.verseEnBanque && c.verseEnBanque > 0) {
      this.ajouter({
        id: randomUUID().slice(0, 8), caisseId, sens: 'sortie', montant: c.verseEnBanque,
        sortie: 'versement_banque', note: 'Versement à la clôture de caisse',
        at: c.arreteeLe, par: input.par,
      });
    }
    return c;
  }

  /** Validation par un supérieur : un arrêté ne se valide pas tout seul. */
  valider(caisseId: string, par: string): Caisse | 'non_arretee' | 'auto_validation' | null {
    const c = this.caisses.get(caisseId);
    if (!c) return null;
    if (c.statut !== 'arretee') return 'non_arretee';
    if (c.titulaire === par) return 'auto_validation';
    c.valideLe = new Date().toISOString();
    c.validePar = par;
    this.repoCaisses?.put(c);
    return c;
  }

  get(caisseId: string): Caisse | undefined { return this.caisses.get(caisseId); }

  etat(caisseId: string): EtatCaisse | null {
    const c = this.caisses.get(caisseId);
    if (!c) return null;
    const mouvements = [...(this.mouvements.get(caisseId) ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const parOrigine: Record<string, number> = {};
    let entrees = 0;
    let sorties = 0;
    for (const m of mouvements) {
      if (m.sens === 'entree') {
        entrees += m.montant;
        if (m.origine) parOrigine[m.origine] = (parOrigine[m.origine] ?? 0) + m.montant;
      } else {
        sorties += m.montant;
      }
    }
    return { ...c, mouvements, entrees, sorties, soldeTheorique: c.fondDeCaisse + entrees - sorties, parOrigine };
  }

  list(filtre: { titulaire?: string; statut?: 'ouverte' | 'arretee'; depuis?: string } = {}): Caisse[] {
    return [...this.caisses.values()]
      .filter((c) => (!filtre.titulaire || c.titulaire === filtre.titulaire)
        && (!filtre.statut || c.statut === filtre.statut)
        && (!filtre.depuis || c.ouverteLe >= filtre.depuis))
      .sort((a, b) => Date.parse(b.ouverteLe) - Date.parse(a.ouverteLe));
  }

  /**
   * Ce que les caisses apportent au rapport financier de l'entreprise. Sans cela,
   * une part réelle des encaissements n'apparaîtrait nulle part dans les comptes.
   */
  consolidation(depuisJours = 30): {
    caissesOuvertes: number;
    especesEnCaisse: number;
    encaisseSurPeriode: number;
    verseEnBanque: number;
    ecartCumule: number;
    arretesNonValides: number;
    parOrigine: Record<string, number>;
    parTresorier: Array<{ titulaire: string; titulaireNom: string; encaisse: number; ecart: number; arretes: number }>;
  } {
    const depuis = new Date(Date.now() - depuisJours * 86_400_000).toISOString();
    const parOrigine: Record<string, number> = {};
    const parTresorier = new Map<string, { titulaire: string; titulaireNom: string; encaisse: number; ecart: number; arretes: number }>();
    let especesEnCaisse = 0;
    let encaisseSurPeriode = 0;
    let verseEnBanque = 0;
    let ecartCumule = 0;
    let caissesOuvertes = 0;
    let arretesNonValides = 0;

    for (const c of this.caisses.values()) {
      if (c.statut === 'ouverte') {
        caissesOuvertes += 1;
        especesEnCaisse += this.soldeTheorique(c.id);
      }
      const dansPeriode = c.ouverteLe >= depuis;
      const ligne = parTresorier.get(c.titulaire)
        ?? { titulaire: c.titulaire, titulaireNom: c.titulaireNom, encaisse: 0, ecart: 0, arretes: 0 };

      for (const m of this.mouvements.get(c.id) ?? []) {
        if (m.at < depuis) continue;
        if (m.sens === 'entree') {
          encaisseSurPeriode += m.montant;
          ligne.encaisse += m.montant;
          if (m.origine) parOrigine[m.origine] = (parOrigine[m.origine] ?? 0) + m.montant;
        } else if (m.sortie === 'versement_banque') {
          verseEnBanque += m.montant;
        }
      }
      if (c.statut === 'arretee' && dansPeriode) {
        ecartCumule += c.ecart ?? 0;
        ligne.ecart += c.ecart ?? 0;
        ligne.arretes += 1;
        if (!c.valideLe) arretesNonValides += 1;
      }
      parTresorier.set(c.titulaire, ligne);
    }

    return {
      caissesOuvertes, especesEnCaisse, encaisseSurPeriode, verseEnBanque, ecartCumule,
      arretesNonValides, parOrigine,
      parTresorier: [...parTresorier.values()].sort((a, b) => b.encaisse - a.encaisse),
    };
  }
}
