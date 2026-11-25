/**
 * Flotte SIGNATURE — véhicules électriques ultra-premium réservés à la LOCATION.
 *
 * Ces modèles ne circulent pas en course ordinaire : ils constituent l'argument
 * différenciant d'ORION pour les mariages, les cérémonies, les délégations
 * officielles et les directions d'entreprise. On ne les trouve nulle part ailleurs
 * dans la sous-région.
 *
 * Le catalogue est VOLONTAIREMENT extensible : ajouter un modèle ici suffit, il
 * apparaît aussitôt dans l'app cliente et dans la console (aucune liste en dur
 * ailleurs). Les prix sont à la journée, en F CFA, chauffeur en tenue inclus.
 *
 * GRILLE : de 60 000 F à 300 000 F la journée. Aucun modèle ne sort de ces bornes —
 * la console les applique aussi (voir rental/settings.ts).
 */
export const PRIX_JOUR_MIN = 60_000;
export const PRIX_JOUR_MAX = 300_000;

export type PrestigeClass = 'signature' | 'presidentielle';

export interface PrestigeVehicle {
  id: string;
  /** Nom commercial affiché au client. */
  name: string;
  marque: string;
  classe: PrestigeClass;
  /** Places assises réellement disponibles pour les passagers. */
  places: number;
  /** Prix de location à la journée (F CFA), chauffeur inclus. */
  prixJour: number;
  /** Autonomie annoncée (km) — argument de sérénité pour un cortège. */
  autonomieKm: number;
  /** Arguments mis en avant dans l'app. */
  atouts: string[];
  /** Nombre d'exemplaires dans la flotte ORION (sert au calcul de disponibilité). */
  exemplaires: number;
}

/**
 * Catalogue Signature. Pour enrichir la gamme : ajouter une entrée — rien d'autre
 * à modifier dans le code.
 */
export const PRESTIGE: PrestigeVehicle[] = [
  {
    id: 'maextro-s800',
    name: 'Huawei Maextro S800',
    marque: 'Huawei',
    classe: 'presidentielle',
    places: 3,
    prixJour: 300_000,
    autonomieKm: 700,
    atouts: ['Limousine présidentielle', 'Sièges arrière à inclinaison totale', 'Isolation phonique renforcée'],
    exemplaires: 2,
  },
  {
    id: 'yangwang-altior',
    name: 'BYD Yangwang U7',
    marque: 'BYD',
    classe: 'presidentielle',
    places: 4,
    prixJour: 250_000,
    autonomieKm: 650,
    atouts: ['Suspension active', 'Tenue de route exceptionnelle', 'Finitions sur mesure'],
    exemplaires: 2,
  },
  {
    id: 'aito-m9',
    name: 'Huawei AITO M9',
    marque: 'Huawei',
    classe: 'signature',
    places: 6,
    prixJour: 180_000,
    autonomieKm: 630,
    atouts: ['Grand SUV 6 places', 'Idéal cortège familial', 'Toit panoramique'],
    exemplaires: 4,
  },
  {
    id: 'nio-es9',
    name: 'NIO ES9',
    marque: 'NIO',
    classe: 'signature',
    places: 5,
    prixJour: 150_000,
    autonomieKm: 640,
    atouts: ['SUV haut de gamme', 'Salon arrière', 'Échange de batterie rapide'],
    exemplaires: 4,
  },
  {
    id: 'nio-et9',
    name: 'NIO ET9',
    marque: 'NIO',
    classe: 'signature',
    places: 4,
    prixJour: 120_000,
    autonomieKm: 620,
    atouts: ['Berline exécutive', 'Suspension pilotée', 'Silence de roulement'],
    exemplaires: 3,
  },
  {
    id: 'stelato-s9',
    name: 'Huawei Stelato S9',
    marque: 'Huawei',
    classe: 'signature',
    places: 4,
    prixJour: 90_000,
    autonomieKm: 600,
    atouts: ['Berline de prestige', 'Assistance de conduite avancée', 'Intérieur cuir clair'],
    exemplaires: 3,
  },
  {
    id: 'zeekr-8x',
    name: 'Zeekr 8X',
    marque: 'Zeekr',
    classe: 'signature',
    places: 6,
    prixJour: 60_000,
    autonomieKm: 580,
    atouts: ['SUV 6 places', 'Coffre généreux', 'Confort de suspension'],
    exemplaires: 3,
  },
];

export const prestigeById = (id: string): PrestigeVehicle | undefined =>
  PRESTIGE.find((v) => v.id === id);

/** Nombre total d'exemplaires d'un modèle dans la flotte. */
export const exemplairesDe = (id: string): number => prestigeById(id)?.exemplaires ?? 0;
