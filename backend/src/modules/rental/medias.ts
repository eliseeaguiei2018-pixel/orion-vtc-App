import { z } from 'zod';
import type { Repository } from '../../core/db/repository.js';

/**
 * PHOTOS ET VIDÉOS RÉELLES DES VÉHICULES (Mariage, Location Signature).
 *
 * Une liste déclarative que l'application cliente lit pour sa vitrine : chaque entrée dit
 * pour quel service, quel véhicule et quelles options elle vaut. La console la remplace en
 * bloc ; les fichiers eux-mêmes sont hébergés ailleurs (stockage d'objets, CDN) et référencés
 * par une adresse https — le serveur ORION ne stocke pas de média.
 */
const adresse = z.string().trim().max(400).regex(/^(https:\/\/[\w.-]+\/[\w\-./%~+]*|medias\/[\w\-./%]+)$/, 'Adresse attendue : https://… ou medias/…');

export const mediaSchema = z.object({
  service: z.enum(['mariage', 'location']),
  /** Gamme (mariage) ou identifiant du véhicule (location) ; « * » : tous. */
  vehicule: z.string().trim().min(1).max(60),
  options: z.record(z.string().max(30), z.union([z.string().max(30), z.number(), z.boolean()])).optional(),
  type: z.enum(['image', 'video']),
  src: adresse,
  affiche: adresse.optional(),
  legende: z.string().trim().max(120).optional(),
});
export const mediasSchema = z.array(mediaSchema).max(300);
export type MediaVehicule = z.infer<typeof mediaSchema>;

interface Enregistrement { id: string; medias: MediaVehicule[]; majLe: string; par?: string }
const ID = 'vitrine';

export class MediasVehiculesService {
  private etat: Enregistrement;

  constructor(private readonly repo?: Repository<Enregistrement>) {
    this.etat = repo?.get(ID) ?? { id: ID, medias: [], majLe: new Date(0).toISOString() };
  }

  liste(): MediaVehicule[] { return this.etat.medias; }
  etatComplet(): { medias: MediaVehicule[]; majLe: string; par?: string } {
    return { medias: this.etat.medias, majLe: this.etat.majLe, par: this.etat.par };
  }

  /** Remplace toute la liste (déjà validée par `mediasSchema`). */
  remplacer(medias: MediaVehicule[], par?: string): MediaVehicule[] {
    this.etat = { id: ID, medias, majLe: new Date().toISOString(), par };
    this.repo?.put(this.etat);
    return this.etat.medias;
  }
}
