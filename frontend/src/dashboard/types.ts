/** État du tableau de bord tel que le renvoie GET /admin/dashboard. */
export interface LatLng { lat: number; lng: number }

export type Service = 'course' | 'livraison';

export interface EntreeJournal {
  id: string;
  at: string;
  genre: 'commande' | 'attribution' | 'approche' | 'arrivee' | 'identite' | 'depart' | 'terminee' | 'paiement' | 'annulation' | 'alerte' | 'secours' | 'message' | 'location';
  niveau: 'info' | 'succes' | 'alerte';
  service?: Service;
  titre: string;
  detail?: string;
  rideId?: string;
}

export interface VehiculeFlotte { id: string; nom: string; categorie: string; moto: boolean; enCourse: boolean; lat: number; lng: number }

export interface CourseActive {
  id: string; service: Service; statut: string; client: string; conducteur: string | null; montant: number;
  origine: LatLng; destination: LatLng; position: LatLng | null; trajet: string; itineraire: LatLng[] | null;
}

export interface EtatTableau {
  genereLe: string;
  devise: string;
  enDirect: { courses: number; livraisons: number; enRecherche: number };
  conducteurs: { enLigne: number; enCourse: number; coursiers: number; total: number };
  aujourdhui: {
    commandes: number; courses: number; livraisons: number; annulees: number;
    chiffreAffaires: number; panierMoyen: number; noteMoyenne: number | null; notes: number; nouveauxClients: number;
  };
  securite: { alertesOuvertes: number; alertesDuJour: number; controles: number; reponsesOk: number; reponsesAlerte: number };
  assurance: { inscrits: number; coursesAssurees: number };
  parHeure: Array<{ heure: number; courses: number; livraisons: number }>;
  paiements: Record<string, number>;
  flotte: VehiculeFlotte[];
  coursesActives: CourseActive[];
  journal: EntreeJournal[];
}

/* ---------------- Objectifs et tendances : GET /admin/dashboard/analyse ---------------- */

export type Periode = 'jour' | 'semaine' | 'mois' | 'annee';
export type StatutObjectif = 'en_avance' | 'dans_les_temps' | 'en_retard';

export interface ObjectifsFinanciers { jour: number; semaine: number; mois: number; annee: number; majLe?: string; majPar?: string }

/** Un point de la courbe cumulée du chiffre d'affaires (null : tranche pas encore arrivée). */
export interface PointCourbe { libelle: string; courant: number | null; precedent: number; objectif: number; montant: number | null; montantPrecedent: number }

export interface AnalysePeriode {
  objectif: number; realise: number; progression: number; fractionEcoulee: number;
  rythmeAttendu: number; statut: StatutObjectif; projection: number | null; projectionRatio: number | null;
  precedentMemeMoment: number; precedentTotal: number; variation: number | null; reste: number;
  courbe: PointCourbe[];
}

export interface PointCommandes { libelle: string; courant: number | null; precedent: number; variation: number | null; enCours?: boolean; moyenne?: number }
export interface JourCommandes { libelle: string; jour: string; commandes: number; moyenne7: number; semainePrecedente: number; variation: number | null; enCours?: boolean }

export interface AnalyseTableau {
  genereLe: string;
  devise: string;
  /** Historique synthétique ajouté (développement et démonstration uniquement). */
  historiqueDemo: boolean;
  objectifs: ObjectifsFinanciers;
  finances: Record<Periode, AnalysePeriode>;
  commandes: {
    parHeure: PointCommandes[];
    parJour: PointCommandes[];
    trenteJours: JourCommandes[];
    parMois: PointCommandes[];
    heureCourante: number;
    jourCourant: string;
  };
  aRetenir: Array<{ genre: 'objectif' | 'hausse' | 'baisse' | 'pic' | 'info'; texte: string }>;
}
