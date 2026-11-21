import type { Country, Driver, Place, PrestigeVehicle, RentalDuree, RentalFormula, SubPlan, TierOption } from './types';

/** Position par défaut : Plateau, Abidjan. */
export const DEFAULT_ORIGIN: Place = {
  id: 'origin',
  name: 'Position actuelle',
  area: 'Plateau, Abidjan',
  location: { lat: 5.3236, lng: -4.0217 },
  kind: 'recent',
};

/** Lieux fréquents d'Abidjan (autocomplétion démo + raccourcis). */
export const ABIDJAN_PLACES: Place[] = [
  { id: 'home', name: 'Domicile', area: 'Cocody, Riviera 3', location: { lat: 5.3599, lng: -3.9876 }, kind: 'home' },
  { id: 'work', name: 'Bureau', area: 'Plateau, Av. Chardy', location: { lat: 5.3256, lng: -4.0185 }, kind: 'work' },
  { id: 'fhb', name: 'Aéroport FHB', area: 'Port-Bouët', location: { lat: 5.2614, lng: -3.9263 }, kind: 'hub' },
  { id: 'pisam', name: 'PISAM', area: 'Cocody', location: { lat: 5.349, lng: -3.999 }, kind: 'recent' },
  { id: 'sococe', name: 'SOCOCE', area: 'Deux Plateaux', location: { lat: 5.378, lng: -3.998 }, kind: 'recent' },
  { id: 'treichville', name: 'Marché de Treichville', area: 'Treichville', location: { lat: 5.2944, lng: -4.005 }, kind: 'recent' },
  { id: 'yopougon', name: 'Yopougon Siporex', area: 'Yopougon', location: { lat: 5.337, lng: -4.09 }, kind: 'recent' },
  { id: 'univ', name: 'Université FHB', area: 'Cocody', location: { lat: 5.345, lng: -3.987 }, kind: 'recent' },
  { id: 'bassam', name: 'Grand-Bassam', area: 'Sud-Comoé', location: { lat: 5.2118, lng: -3.7388 }, kind: 'recent' },
  { id: 'gare', name: 'Gare d’Adjamé', area: 'Adjamé', location: { lat: 5.358, lng: -4.024 }, kind: 'hub' },
];

/**
 * Trois gammes de course (Argent, Or, Diamant), flottes 100 % électriques. Miroir du
 * catalogue du serveur : l'Argent est la grille de référence (l'ancienne grille Bronze),
 * l'Or coûte 700 F de plus sur le même trajet, le Diamant 1 000 F de plus que l'Or.
 */
export const TIERS: TierOption[] = [
  { id: 'argent', key: 'tier_argent', multiplier: 0.9, supplement: 0, capacity: 4, eta: 3, accent: '#c8d2dc', weddingDayPrice: 60000, cars: ['Geely Galaxy E8', 'Dongfeng 007', 'Changan Qiyuan A07', 'Deepal S07', 'AVATR 06'] },
  { id: 'or', key: 'tier_or', multiplier: 0.9, supplement: 700, capacity: 4, eta: 4, accent: '#f5c451', weddingDayPrice: 110000, cars: ['AVATR 11', 'AVATR 12', 'Xiaomi YU7', 'XPENG G9'] },
  { id: 'diamant', key: 'tier_diamant', multiplier: 0.9, supplement: 1700, capacity: 4, eta: 5, accent: '#7fe7ff', weddingDayPrice: 190000, cars: ['XPENG GX 750 Ultra', 'Huawei Stelato S9', 'NIO ET9', 'NIO ES9', 'Zeekr 8X'] },
];

export const tierById = (id: string): TierOption => TIERS.find((t) => t.id === id) ?? TIERS[0]!;

/** Abonnements mensuels : packs Argent, Or, Diamant (les identifiants historiques sont conservés). */
export const SUB_PLANS: SubPlan[] = [
  { id: 'bronze', key: 'tier_argent', ridesPerDay: 2, monthlyPrice: 25000, accent: '#8e98a4',
    benefits: ['2 courses incluses / jour', 'Gamme Argent', 'Support standard'] },
  { id: 'argent', key: 'tier_or', ridesPerDay: 3, monthlyPrice: 38000, accent: '#c79a1e',
    benefits: ['3 courses incluses / jour', 'Gammes Argent et Or', 'Priorité de mise en relation', '-10% au-delà du quota'] },
  { id: 'gold', key: 'tier_diamant', ridesPerDay: 4, monthlyPrice: 55000, accent: '#6a35f0',
    benefits: ['4 courses incluses / jour', 'Toutes les gammes (Diamant inclus)', 'Priorité maximale', '-15% au-delà du quota', 'Annulation gratuite'] },
];

/**
 * Pays : ORION opère en Côte d'Ivoire. Les autres pays ne sont pas affichés tant que
 * l'ouverture n'est pas décidée — une promesse « Bientôt » sans date n'apporte rien au client.
 */
export const COUNTRIES: Country[] = [
  { code: 'CI', name: "Côte d'Ivoire", flag: '🇨🇮', currency: 'XOF', dialCode: '+225', status: 'active' },
];

export const DRIVERS: Driver[] = [
  { name: 'Konan Yao', matricule: 'ORION-CI-4821', rating: 4.96, trips: 2847, plate: 'CI-4821-AB', car: '', color: 'Vert émeraude' },
  { name: 'Aïcha Touré', matricule: 'ORION-CI-1207', rating: 4.99, trips: 3120, plate: 'CI-1207-CD', car: '', color: 'Blanc nacré' },
  { name: 'Mamadou Bamba', matricule: 'ORION-CI-9034', rating: 4.92, trips: 1980, plate: 'CI-9034-EF', car: '', color: 'Gris titane' },
];

export const WEDDING_FEES = { decoration: 35000, convoyPerCar: 40000 };
export const WEDDING_DURATION_FACTOR: Record<string, number> = { halfday: 0.6, fullday: 1, weekend: 1.8 };

export const formatXOF = (n: number): string =>
  new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' F';

/* ------------------- LOCATION ORION — gamme Signature (repli démo) -------------------
 *
 * Le catalogue de référence est servi par le backend (/rental/catalogue) : c'est lui
 * qui fait foi. Cette copie ne sert QU'EN MODE DÉMO, quand aucun backend n'est
 * joignable, pour que l'écran de location reste présentable sans infrastructure.
 */
export const PRESTIGE_FALLBACK: PrestigeVehicle[] = [
  { id: 'maextro-s800', name: 'Huawei Maextro S800', marque: 'Huawei', classe: 'presidentielle', places: 3, prixJour: 300000, autonomieKm: 700, exemplaires: 2,
    atouts: ['Limousine présidentielle', 'Sièges arrière à inclinaison totale', 'Isolation phonique renforcée'] },
  { id: 'yangwang-altior', name: 'BYD Yangwang U7', marque: 'BYD', classe: 'presidentielle', places: 4, prixJour: 250000, autonomieKm: 650, exemplaires: 2,
    atouts: ['Suspension active', 'Tenue de route exceptionnelle', 'Finitions sur mesure'] },
  { id: 'aito-m9', name: 'Huawei AITO M9', marque: 'Huawei', classe: 'signature', places: 6, prixJour: 180000, autonomieKm: 630, exemplaires: 4,
    atouts: ['Grand SUV 6 places', 'Idéal cortège familial', 'Toit panoramique'] },
  { id: 'nio-es9', name: 'NIO ES9', marque: 'NIO', classe: 'signature', places: 5, prixJour: 150000, autonomieKm: 640, exemplaires: 4,
    atouts: ['SUV haut de gamme', 'Salon arrière', 'Échange de batterie rapide'] },
  { id: 'nio-et9', name: 'NIO ET9', marque: 'NIO', classe: 'signature', places: 4, prixJour: 120000, autonomieKm: 620, exemplaires: 3,
    atouts: ['Berline exécutive', 'Suspension pilotée', 'Silence de roulement'] },
  { id: 'stelato-s9', name: 'Huawei Stelato S9', marque: 'Huawei', classe: 'signature', places: 4, prixJour: 90000, autonomieKm: 600, exemplaires: 3,
    atouts: ['Berline de prestige', 'Assistance de conduite avancée', 'Intérieur cuir clair'] },
  { id: 'zeekr-8x', name: 'Zeekr 8X', marque: 'Zeekr', classe: 'signature', places: 6, prixJour: 60000, autonomieKm: 580, exemplaires: 3,
    atouts: ['SUV 6 places', 'Coffre généreux', 'Confort de suspension'] },
];

/** Barème de location (repli démo — miroir de backend/src/modules/rental/tariff.ts). */
export const RENTAL_TARIFF = {
  decoration: 20000, tapisRouge: 15000, hotesse: 25000, escorte: 60000, plaque: 10000,
  secondChauffeur: 20000, rafraichissements: 10000,
  remiseCortege: 0.15, kmInclusParJour: 100, prixKmSupp: 300,
  majorationKmIllimite: 0.18, majorationJourJ: 0.12, tauxCaution: 0.15,
  ratioHeure: 0.17, minHeures: 3, maxHeures: 12, heuresParJournee: 10,
  /** Forfait mensuel : remise par mois dès 3, 6 et 12 mois d'engagement. */
  remiseMois3: 0.35, remiseMois6: 0.4, remiseMois12: 0.45,
  /** Une entreprise s'engage pour six mois au moins. */
  moisMinEntreprise: 6,
};

export const RENTAL_COEF: Record<string, number> = { journee: 1, weekend: 1.8, semaine: 5.5, mois: 21 };
export const RENTAL_JOURS: Record<string, number> = { journee: 1, weekend: 2, semaine: 7, mois: 30 };
/** Un contrat mensuel ne dépasse pas trois ans. */
export const RENTAL_MOIS_MAX = 36;

/** Remise par mois d'un forfait de `mois` mois (même règle que le serveur). */
export function remiseMensuelle(mois: number, t: { remiseMois3: number; remiseMois6: number; remiseMois12: number } = RENTAL_TARIFF, coefMois = RENTAL_COEF.mois ?? 21): number {
  const base = Math.min(0.9, Math.max(0, 1 - coefMois / 30));
  const p3 = Math.max(base, t.remiseMois3);
  const p6 = Math.max(p3, t.remiseMois6);
  const p12 = Math.max(p6, t.remiseMois12);
  if (mois >= 12) return p12;
  if (mois >= 6) return p6;
  if (mois >= 3) return p3;
  return base;
}

/** Durées qu'une formule peut vendre : une entreprise ne loue qu'au forfait mensuel. */
export function dureesPermises(formula: RentalFormula): RentalDuree[] {
  return formula === 'entreprise' ? ['mois'] : RENTAL_DUREES;
}

export const RENTAL_FORMULES: RentalFormula[] = ['evenement', 'entreprise', 'mise_a_disposition'];
export const RENTAL_DUREES: RentalDuree[] = ['heures', 'journee', 'weekend', 'semaine', 'mois'];
/** Options proposées à l'écran, dans l'ordre d'affichage. */
export const RENTAL_OPTION_KEYS = [
  'decoration', 'tapisRouge', 'plaque', 'rafraichissements', 'escorte', 'kilometrageIllimite',
] as const;
