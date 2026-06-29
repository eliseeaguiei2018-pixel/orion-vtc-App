import type { Driver, Place, Vehicle } from './types';

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

export const VEHICLES: Vehicle[] = [
  { id: 'eco', label: 'Orion Éco', tagline: 'Le plus économique', multiplier: 0.85, capacity: 4, eta: 4, icon: 'eco' },
  { id: 'green', label: 'Orion Green', tagline: '100% électrique', multiplier: 1, capacity: 4, eta: 3, icon: 'green' },
  { id: 'comfort', label: 'Orion Confort', tagline: 'Berlines premium', multiplier: 1.35, capacity: 4, eta: 5, icon: 'comfort' },
  { id: 'van', label: 'Orion Van', tagline: 'Jusqu’à 6 places', multiplier: 1.9, capacity: 6, eta: 7, icon: 'van' },
];

export const DRIVERS: Driver[] = [
  { name: 'Konan Yao', rating: 4.96, trips: 2847, plate: 'CI-4821-AB', car: 'Hyundai Kona EV', color: 'Vert émeraude' },
  { name: 'Aïcha Touré', rating: 4.99, trips: 3120, plate: 'CI-1207-CD', car: 'BYD Atto 3', color: 'Blanc nacré' },
  { name: 'Mamadou Bamba', rating: 4.92, trips: 1980, plate: 'CI-9034-EF', car: 'Kia Niro EV', color: 'Gris titane' },
];

export const formatXOF = (n: number): string =>
  new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' F';
