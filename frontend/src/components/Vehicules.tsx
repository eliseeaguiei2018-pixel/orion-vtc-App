import type { CSSProperties, ReactNode } from 'react';
import { useTheme } from '../theme';

/**
 * VÉHICULES ET OBJETS D'ORION — des rendus en volume, pas des dessins.
 *
 * Chaque image est un objet modélisé puis éclairé comme en studio (Blender, moteur
 * Cycles) dans les teintes de la marque : vert, blanc, violet. Les modèles et l'éclairage
 * sont décrits dans `scripts/rendus-3d/` ; les images sont dans `public/rendus/`.
 * L'interface autour reste neutre : c'est l'objet qui porte la couleur.
 */
export type Modele = 'citadine' | 'berline' | 'suv' | 'luxe';
export type Peinture = 'accent' | 'bronze' | 'argent' | 'or' | 'diamant' | 'nuit' | 'perle';

/** Adresse d'un rendu livré avec l'application (chemin relatif : il suit l'app partout). */
export const rendu = (nom: string): string => `${import.meta.env.BASE_URL}rendus/${nom}.webp`;

/** Objets des services de l'accueil. */
export type ObjetService =
  | 'food' | 'achat' | 'supermarche' | 'colis' | 'abonnement' | 'location' | 'mariage' | 'mes-courses' | 'aide';

/** Icônes en volume des listes et des boutons (paramètres, urgences, packs, lieux). */
export type Icone3D =
  | 'pack-argent' | 'pack-or' | 'pack-diamant' | 'samu' | 'police' | 'pompiers'
  | 'reglages' | 'assurance' | 'historique' | 'alertes-sos' | 'portefeuille' | 'cadenas' | 'document' | 'serveur'
  | 'telephone' | 'message' | 'wifi' | 'lieu' | 'destination' | 'domicile' | 'bureau' | 'banque' | 'aeroport'
  | 'ecole' | 'eglise' | 'mosquee' | 'hotel' | 'carburant' | 'bus' | 'loisirs' | 'immeuble' | 'parc';

/** Numéro d'urgence → son objet (185 SAMU, 170 police, 180 pompiers). */
export const objetUrgence = (numero: string): Icone3D => (numero === '185' ? 'samu' : numero === '180' ? 'pompiers' : 'police');

/** Pack d'abonnement → sa couronne (identifiants historiques : bronze, argent, gold). */
export const objetPack = (plan: string): Icone3D => (plan === 'gold' ? 'pack-diamant' : plan === 'argent' ? 'pack-or' : 'pack-argent');

/** Gamme ORION → carrosserie et peinture (Argent, Or, Diamant : trois berlines, trois teintes). */
export function vehiculeDeGamme(gamme: string): { modele: Modele; peinture: Peinture } {
  switch (gamme) {
    case 'argent': case 'bronze': return { modele: 'berline', peinture: 'argent' };
    case 'or': return { modele: 'berline', peinture: 'or' };
    case 'diamant': return { modele: 'berline', peinture: 'diamant' };
    default: return { modele: 'berline', peinture: 'accent' };
  }
}

/** Nom du rendu pour une carrosserie et une peinture. */
function fichierVoiture(modele: Modele, peinture: Peinture, accent: string): string {
  if (peinture === 'nuit') return 'limousine-nuit';
  const caisse = modele === 'suv' ? 'suv' : 'berline';
  if (peinture === 'perle') return `${caisse}-perle`;
  if (peinture === 'accent') return caisse === 'suv' ? 'suv-orion' : accent === 'vert' ? 'berline-orion' : `berline-${accent}`;
  return `${caisse}-${peinture === 'bronze' ? 'argent' : peinture}`;
}

/** Image d'un rendu : dimensions fixées, pour que la page ne saute pas au chargement. */
function Rendu({ nom, largeur, ratio, classe = '' }: { nom: string; largeur: number; ratio: number; classe?: string }) {
  return (
    <img
      className={`vehicule ${classe}`.trim()} src={rendu(nom)} alt="" aria-hidden="true" draggable={false}
      width={Math.round(largeur)} height={Math.round(largeur * ratio)} decoding="async"
    />
  );
}

/** Voiture vue de trois quarts. `phares` est conservé pour les appels existants. */
export function Voiture({ modele = 'berline', peinture = 'accent', largeur = 120 }: {
  modele?: Modele; peinture?: Peinture; largeur?: number; phares?: boolean;
}) {
  const { accent } = useTheme();
  return <Rendu nom={fichierVoiture(modele, peinture, accent)} largeur={largeur} ratio={0.58} />;
}

/** Scooter électrique de livraison, avec son coffre. */
export function Scooter({ largeur = 120 }: { largeur?: number }) {
  return <Rendu nom="scooter" largeur={largeur * 0.82} ratio={0.875} classe="scooter" />;
}

/** Objet d'un service (repas, sacs, panier, colis, carte, clé, alliances, itinéraire, casque). */
export function Objet({ nom, taille = 96 }: { nom: ObjetService | Icone3D; taille?: number }) {
  return <Rendu nom={nom} largeur={taille} ratio={1} classe="objet" />;
}

/** Vue de dessus, pour le repère du véhicule sur la carte. */
export function VoitureDessus({ taille = 26 }: { taille?: number }) {
  const { accent } = useTheme();
  return <Rendu nom={accent === 'vert' ? 'voiture-dessus' : `voiture-dessus-${accent}`} largeur={taille} ratio={2} />;
}

/**
 * Tuile de service : l'objet en volume sur un carré arrondi, le nom dessous. `rang` décale
 * l'entrée et le flottement de l'objet, pour que les tuiles ne bougent pas toutes ensemble.
 */
export function Tuile({ objet, label, note, grande, off, rang = 0, onClick }: {
  objet: ReactNode; label: string; note?: string; grande?: boolean; off?: boolean; rang?: number; onClick: () => void;
}) {
  return (
    <button className={`tuile${grande ? ' grande' : ''}${off ? ' off' : ''}`} style={{ '--i': rang } as CSSProperties} onClick={onClick} disabled={off}>
      <span className="tuile-fond">{objet}</span>
      <strong className="tuile-nom">{label}</strong>
      {note && <span className="tuile-note">{note}</span>}
    </button>
  );
}
