import type { Repository } from '../../core/db/repository.js';
import { PRESTIGE, PRIX_JOUR_MAX, PRIX_JOUR_MIN, type PrestigeVehicle } from '../fleet/prestige.js';
import {
  COEF_DUREE, DELAI_EXPRESS_MAX, DELAI_EXPRESS_MIN, FRAIS, MAX_HEURES, MIN_HEURES, MOIS_MIN_ENTREPRISE,
  RATIO_HEURE, REMISE_ENGAGEMENT,
  type RentalDuree,
} from './tariff.js';

/**
 * TARIFS DE LOCATION PILOTÉS DEPUIS LA CONSOLE.
 *
 * Les prix journaliers, le nombre d'exemplaires et tout le barème vivaient en constantes
 * dans le code : personne chez ORION ne pouvait les ajuster sans un développeur, un
 * commit et un déploiement. C'est l'inverse d'un outil de travail — la tarification est
 * une décision commerciale, elle appartient à l'équipe, pas au code source.
 *
 * Le catalogue du code reste la RÉFÉRENCE DE DÉPART (nom, classe, places, autonomie,
 * atouts). La console ne modifie que ce qui relève du commerce et de l'exploitation :
 * le prix à la journée, le nombre d'exemplaires et la mise en vente du modèle.
 */

/** Ce que la console peut changer sur un véhicule de la gamme Signature. */
export interface VehiculeTarif {
  prixJour: number;
  exemplaires: number;
  /** Retiré de la vente sans être supprimé (véhicule en maintenance, modèle en attente). */
  actif: boolean;
}

/** Barème complet, modifiable depuis la console. */
export interface RentalTarif {
  /** Coefficient appliqué au prix journée, par durée. */
  coefs: Record<Exclude<RentalDuree, 'heures'>, number>;
  /** Forfait mensuel : remise par mois dès 3, 6 et 12 mois d'engagement (0–0,7). */
  remiseMois3: number;
  remiseMois6: number;
  remiseMois12: number;
  /** Engagement minimal d'un contrat entreprise, en mois. */
  moisMinEntreprise: number;
  /** Part du prix journée facturée par heure (location à l'heure). */
  ratioHeure: number;
  minHeures: number;
  maxHeures: number;
  /** Frais fixes des options (F CFA). */
  decoration: number;
  tapisRouge: number;
  hotesse: number;
  escorte: number;
  plaque: number;
  secondChauffeur: number;
  rafraichissements: number;
  /** Remise accordée sur chaque véhicule supplémentaire du cortège (0–0,5). */
  remiseCortege: number;
  kmInclusParJour: number;
  prixKmSupp: number;
  /** Majoration du poste véhicule pour le kilométrage illimité (0–1). */
  majorationKmIllimite: number;
  /** Majoration de mobilisation express le jour même (0–1). */
  majorationJourJ: number;
  /** Caution, en part du total hors taxes (0–1). */
  tauxCaution: number;
  /** Délai de mise à disposition le jour même : flotte libre → flotte chargée (minutes). */
  delaiExpressMin: number;
  delaiExpressMax: number;
}

export const DEFAUT_TARIF: RentalTarif = {
  coefs: { ...COEF_DUREE },
  remiseMois3: REMISE_ENGAGEMENT.mois3,
  remiseMois6: REMISE_ENGAGEMENT.mois6,
  remiseMois12: REMISE_ENGAGEMENT.mois12,
  moisMinEntreprise: MOIS_MIN_ENTREPRISE,
  ratioHeure: RATIO_HEURE,
  minHeures: MIN_HEURES,
  maxHeures: MAX_HEURES,
  decoration: FRAIS.decoration,
  tapisRouge: FRAIS.tapisRouge,
  hotesse: FRAIS.hotesse,
  escorte: FRAIS.escorte,
  plaque: FRAIS.plaque,
  secondChauffeur: FRAIS.secondChauffeur,
  rafraichissements: FRAIS.rafraichissements,
  remiseCortege: FRAIS.remiseCortege,
  kmInclusParJour: FRAIS.kmInclusParJour,
  prixKmSupp: FRAIS.prixKmSupp,
  majorationKmIllimite: FRAIS.majorationKmIllimite,
  majorationJourJ: FRAIS.majorationJourJ,
  tauxCaution: FRAIS.tauxCaution,
  delaiExpressMin: DELAI_EXPRESS_MIN,
  delaiExpressMax: DELAI_EXPRESS_MAX,
};

/** Enregistrement persisté (une seule ligne). */
export interface RentalTarifRecord {
  id: string;
  tarif: RentalTarif;
  vehicules: Record<string, VehiculeTarif>;
  /** Qui a modifié en dernier, et quand — la tarification se justifie. */
  modifiePar?: string;
  modifieLe?: string;
}

const RECORD_ID = 'rental_tarifs';

/** Bornes de sécurité : un doigt qui ripe ne doit pas brader la flotte ni tripler un prix. */
const borne = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface RentalTarifPatch {
  tarif?: Omit<Partial<RentalTarif>, 'coefs'> & { coefs?: Partial<Record<Exclude<RentalDuree, 'heures'>, number>> };
  vehicules?: Record<string, Partial<VehiculeTarif>>;
  /** Nom de l'employé à l'origine du changement (journalisé). */
  acteur?: string;
}

export class RentalSettingsService {
  private tarif: RentalTarif;
  private vehicules: Record<string, VehiculeTarif>;
  private modifiePar?: string;
  private modifieLe?: string;
  private changeHandler?: () => void;

  constructor(private readonly repo?: Repository<RentalTarifRecord>) {
    const saved = repo?.get(RECORD_ID);
    // ANCIENNE GRILLE (420 000 à 900 000 F la journée, sans forfait d'engagement) :
    // un barème enregistré avant la refonte ferait revenir les anciens prix au premier
    // redémarrage. On repart alors de la grille en vigueur ; les stocks et les modèles
    // retirés de la vente, eux, restent ceux que l'exploitation a réglés.
    const ancienneGrille = Boolean(saved) && (
      saved!.tarif?.remiseMois6 === undefined ||
      Object.values(saved!.vehicules ?? {}).some((v) => (v?.prixJour ?? 0) > PRIX_JOUR_MAX)
    );
    const tarifSauve = ancienneGrille ? undefined : saved?.tarif;
    // Fusion avec les défauts : un enregistrement écrit avant l'ajout d'un champ
    // reste valide, et un modèle ajouté au catalogue apparaît avec son prix d'origine.
    this.tarif = { ...DEFAUT_TARIF, ...(tarifSauve ?? {}), coefs: { ...DEFAUT_TARIF.coefs, ...(tarifSauve?.coefs ?? {}) } };
    this.vehicules = {};
    for (const v of PRESTIGE) {
      const s = saved?.vehicules?.[v.id];
      this.vehicules[v.id] = {
        prixJour: ancienneGrille ? v.prixJour : borne(s?.prixJour ?? v.prixJour, PRIX_JOUR_MIN, PRIX_JOUR_MAX),
        exemplaires: s?.exemplaires ?? v.exemplaires,
        actif: s?.actif ?? true,
      };
    }
    this.modifiePar = saved?.modifiePar;
    this.modifieLe = saved?.modifieLe;
  }

  /** Diffusion temps réel du nouveau barème aux apps connectées. */
  onChange(handler: () => void): void { this.changeHandler = handler; }

  getTarif(): RentalTarif { return this.tarif; }

  /** Qui a fixé les tarifs en vigueur, et quand. */
  getOrigine(): { modifiePar: string | null; modifieLe: string | null } {
    return { modifiePar: this.modifiePar ?? null, modifieLe: this.modifieLe ?? null };
  }

  /** Catalogue EFFECTIF : le descriptif du code, les prix et stocks de la console. */
  vehicules_(): PrestigeVehicle[] {
    return PRESTIGE.map((v) => {
      const t = this.vehicules[v.id]!;
      return { ...v, prixJour: t.prixJour, exemplaires: t.exemplaires };
    });
  }

  /** Modèles réellement proposés à la vente (les retirés restent en base). */
  catalogue(): PrestigeVehicle[] {
    return this.vehicules_().filter((v) => this.vehicules[v.id]?.actif !== false);
  }

  /** Un modèle du catalogue effectif, qu'il soit en vente ou non. */
  vehicule(id: string): PrestigeVehicle | undefined {
    return this.vehicules_().find((v) => v.id === id);
  }

  estActif(id: string): boolean { return this.vehicules[id]?.actif !== false; }

  /** Exemplaires réellement exploitables (0 si le modèle est retiré de la vente). */
  exemplaires(id: string): number {
    const t = this.vehicules[id];
    if (!t || t.actif === false) return 0;
    return t.exemplaires;
  }

  /** État complet pour la console (y compris les modèles retirés). */
  etat(): { tarif: RentalTarif; vehicules: Array<PrestigeVehicle & { actif: boolean }>; origine: { modifiePar: string | null; modifieLe: string | null } } {
    return {
      tarif: this.tarif,
      vehicules: this.vehicules_().map((v) => ({ ...v, actif: this.estActif(v.id) })),
      origine: this.getOrigine(),
    };
  }

  /**
   * Applique un changement de tarif. Chaque valeur est bornée : la console doit
   * permettre d'ajuster, pas de casser la grille par une faute de frappe.
   */
  update(patch: RentalTarifPatch): RentalTarifRecord {
    const p = patch.tarif;
    if (p) {
      this.tarif = {
        ...this.tarif,
        coefs: {
          journee: borne(p.coefs?.journee ?? this.tarif.coefs.journee, 0.2, 3),
          weekend: borne(p.coefs?.weekend ?? this.tarif.coefs.weekend, 0.2, 6),
          semaine: borne(p.coefs?.semaine ?? this.tarif.coefs.semaine, 1, 20),
          mois: borne(p.coefs?.mois ?? this.tarif.coefs.mois, 6, 30),
        },
        remiseMois3: borne(p.remiseMois3 ?? this.tarif.remiseMois3, 0, 0.7),
        remiseMois6: borne(p.remiseMois6 ?? this.tarif.remiseMois6, 0, 0.7),
        remiseMois12: borne(p.remiseMois12 ?? this.tarif.remiseMois12, 0, 0.7),
        moisMinEntreprise: Math.round(borne(p.moisMinEntreprise ?? this.tarif.moisMinEntreprise, 1, 24)),
        ratioHeure: borne(p.ratioHeure ?? this.tarif.ratioHeure, 0.05, 0.5),
        minHeures: Math.round(borne(p.minHeures ?? this.tarif.minHeures, 1, 12)),
        maxHeures: Math.round(borne(p.maxHeures ?? this.tarif.maxHeures, 2, 24)),
        decoration: Math.round(borne(p.decoration ?? this.tarif.decoration, 0, 2_000_000)),
        tapisRouge: Math.round(borne(p.tapisRouge ?? this.tarif.tapisRouge, 0, 2_000_000)),
        hotesse: Math.round(borne(p.hotesse ?? this.tarif.hotesse, 0, 2_000_000)),
        escorte: Math.round(borne(p.escorte ?? this.tarif.escorte, 0, 5_000_000)),
        plaque: Math.round(borne(p.plaque ?? this.tarif.plaque, 0, 1_000_000)),
        secondChauffeur: Math.round(borne(p.secondChauffeur ?? this.tarif.secondChauffeur, 0, 2_000_000)),
        rafraichissements: Math.round(borne(p.rafraichissements ?? this.tarif.rafraichissements, 0, 1_000_000)),
        remiseCortege: borne(p.remiseCortege ?? this.tarif.remiseCortege, 0, 0.5),
        kmInclusParJour: Math.round(borne(p.kmInclusParJour ?? this.tarif.kmInclusParJour, 0, 2_000)),
        prixKmSupp: Math.round(borne(p.prixKmSupp ?? this.tarif.prixKmSupp, 0, 20_000)),
        majorationKmIllimite: borne(p.majorationKmIllimite ?? this.tarif.majorationKmIllimite, 0, 1),
        majorationJourJ: borne(p.majorationJourJ ?? this.tarif.majorationJourJ, 0, 1),
        tauxCaution: borne(p.tauxCaution ?? this.tarif.tauxCaution, 0, 1),
        delaiExpressMin: Math.round(borne(p.delaiExpressMin ?? this.tarif.delaiExpressMin, 5, 240)),
        delaiExpressMax: Math.round(borne(p.delaiExpressMax ?? this.tarif.delaiExpressMax, 5, 480)),
      };
      // Un minimum au-dessus du maximum rendrait le barème incohérent.
      if (this.tarif.maxHeures < this.tarif.minHeures) this.tarif.maxHeures = this.tarif.minHeures;
      if (this.tarif.delaiExpressMax < this.tarif.delaiExpressMin) this.tarif.delaiExpressMax = this.tarif.delaiExpressMin;
    }

    for (const [id, v] of Object.entries(patch.vehicules ?? {})) {
      const actuel = this.vehicules[id];
      if (!actuel) continue; // modèle inconnu : on ignore plutôt que d'inventer une ligne
      this.vehicules[id] = {
        // La grille est bornée : de 60 000 à 300 000 F la journée, pas au-delà.
        prixJour: Math.round(borne(v.prixJour ?? actuel.prixJour, PRIX_JOUR_MIN, PRIX_JOUR_MAX)),
        exemplaires: Math.round(borne(v.exemplaires ?? actuel.exemplaires, 0, 200)),
        actif: v.actif ?? actuel.actif,
      };
    }

    if (patch.acteur) this.modifiePar = patch.acteur;
    this.modifieLe = new Date().toISOString();

    const record: RentalTarifRecord = {
      id: RECORD_ID,
      tarif: this.tarif,
      vehicules: this.vehicules,
      modifiePar: this.modifiePar,
      modifieLe: this.modifieLe,
    };
    this.repo?.put(record);
    try { this.changeHandler?.(); } catch { /* une diffusion ratée ne doit pas annuler le réglage */ }
    return record;
  }

  /** Retour au barème d'origine (catalogue du code). */
  reset(acteur?: string): RentalTarifRecord {
    this.tarif = { ...DEFAUT_TARIF, coefs: { ...DEFAUT_TARIF.coefs } };
    this.vehicules = {};
    for (const v of PRESTIGE) this.vehicules[v.id] = { prixJour: v.prixJour, exemplaires: v.exemplaires, actif: true };
    return this.update({ acteur });
  }
}
