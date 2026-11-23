import { createContext } from 'react';
import type { LatLng } from '../types';
import type { VehiculeProche } from '../api';

/**
 * ACTUALISER MA POSITION, sur la carte.
 *
 * Avant la course, le client relit sa position GPS : le point de prise en charge le suit.
 * Pendant la course, la carte montre où il se trouve vraiment (repère « vous êtes ici »).
 * L'application fournit ce contexte autour des écrans de commande et de suivi ; la carte
 * affiche alors la bulle. Ailleurs (app chauffeur, écrans sans carte), il est absent.
 */
export interface GpsCarteValeur {
  /** Position réelle du téléphone, quand elle est connue. */
  moi: LatLng | null;
  /** Lecture du GPS en cours. */
  occupe: boolean;
  actualiser: () => void;
  libelle: string;
  /** Véhicules libres autour du départ (avant la commande) : la carte les fait rouler. */
  voisins?: VehiculeProche[];
}
export const GpsCarte = createContext<GpsCarteValeur | null>(null);
