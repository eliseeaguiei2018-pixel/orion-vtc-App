import type { Country, Driver, Place, SubPlan, TierOption } from './types';

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

/** Niveaux de course (Bronze → Diamant) avec leurs flottes 100% électriques. */
export const TIERS: TierOption[] = [
  { id: 'bronze', key: 'tier_bronze', multiplier: 0.9, capacity: 4, eta: 3, accent: '#cd7f4d', weddingDayPrice: 60000, cars: ['Geely Galaxy E8', 'Dongfeng 007', 'Changan Qiyuan A07'] },
  { id: 'argent', key: 'tier_argent', multiplier: 1.25, capacity: 4, eta: 4, accent: '#c8d2dc', weddingDayPrice: 110000, cars: ['Deepal S07', 'AVATR 06', 'AVATR 11'] },
  { id: 'or', key: 'tier_or', multiplier: 1.7, capacity: 4, eta: 5, accent: '#f5c451', weddingDayPrice: 190000, cars: ['AVATR 12', 'Xiaomi YU7', 'XPENG G9', 'XPENG GX 750 Ultra'] },
  { id: 'diamant', key: 'tier_diamant', multiplier: 2.3, capacity: 4, eta: 6, accent: '#7fe7ff', weddingDayPrice: 320000, cars: ['Huawei Stelato S9', 'NIO ET9', 'NIO ES9', 'Zeekr 8X'] },
];

export const tierById = (id: string): TierOption => TIERS.find((t) => t.id === id) ?? TIERS[0]!;

/** Abonnements mensuels. */
export const SUB_PLANS: SubPlan[] = [
  { id: 'bronze', key: 'tier_bronze', ridesPerDay: 2, monthlyPrice: 25000, accent: '#cd7f4d',
    benefits: ['2 courses incluses / jour', 'Niveaux Bronze & Argent', 'Support standard'] },
  { id: 'argent', key: 'tier_argent', ridesPerDay: 3, monthlyPrice: 38000, accent: '#c8d2dc',
    benefits: ['3 courses incluses / jour', 'Niveaux jusqu’à Or', 'Priorité de mise en relation', '-10% au-delà du quota'] },
  { id: 'gold', key: 'tier_or', ridesPerDay: 4, monthlyPrice: 55000, accent: '#f5c451',
    benefits: ['4 courses incluses / jour', 'Tous les niveaux (Diamant inclus)', 'Priorité maximale', '-15% au-delà du quota', 'Annulation gratuite'] },
];

/** Pays : CI actif + expansion sous-régionale. */
export const COUNTRIES: Country[] = [
  { code: 'CI', name: "Côte d'Ivoire", flag: '🇨🇮', currency: 'XOF', dialCode: '+225', status: 'active' },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', currency: 'GHS', dialCode: '+233', status: 'coming_soon' },
  { code: 'SN', name: 'Sénégal', flag: '🇸🇳', currency: 'XOF', dialCode: '+221', status: 'coming_soon' },
  { code: 'TG', name: 'Togo', flag: '🇹🇬', currency: 'XOF', dialCode: '+228', status: 'coming_soon' },
  { code: 'BJ', name: 'Bénin', flag: '🇧🇯', currency: 'XOF', dialCode: '+229', status: 'coming_soon' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', currency: 'NGN', dialCode: '+234', status: 'coming_soon' },
];

export const DRIVERS: Driver[] = [
  { name: 'Konan Yao', rating: 4.96, trips: 2847, plate: 'CI-4821-AB', car: '', color: 'Vert émeraude' },
  { name: 'Aïcha Touré', rating: 4.99, trips: 3120, plate: 'CI-1207-CD', car: '', color: 'Blanc nacré' },
  { name: 'Mamadou Bamba', rating: 4.92, trips: 1980, plate: 'CI-9034-EF', car: '', color: 'Gris titane' },
];

export const WEDDING_FEES = { decoration: 35000, convoyPerCar: 40000 };
export const WEDDING_DURATION_FACTOR: Record<string, number> = { halfday: 0.6, fullday: 1, weekend: 1.8 };

export const formatXOF = (n: number): string =>
  new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' F';
