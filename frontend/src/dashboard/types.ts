/** État du tableau de bord tel que le renvoie GET /admin/dashboard. */
export interface LatLng { lat: number; lng: number }

export type Service = 'course' | 'livraison';

export interface EntreeJournal {
  id: string;
  at: string;
  genre: 'commande' | 'attribution' | 'approche' | 'arrivee' | 'depart' | 'terminee' | 'paiement' | 'annulation' | 'alerte' | 'secours' | 'message' | 'location';
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
