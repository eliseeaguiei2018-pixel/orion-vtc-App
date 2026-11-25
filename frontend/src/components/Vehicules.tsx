import type { CSSProperties, ReactNode } from 'react';
import { ACCENTS_RENDUS, useAccentSur, useStyleOrionSur } from '../theme';
import {
  IconAlarm, IconAward, IconBadge, IconBag, IconBank, IconBriefcase, IconBuilding, IconBus, IconCalendar, IconCar, IconCarburant, IconCart, IconChart, IconGift,
  IconClock, IconCrown, IconEcole, IconEglise, IconFile, IconFlag, IconFlame, IconGem, IconHeadset, IconHome, IconKey, IconLeaf, IconLit, IconLock,
  IconMap, IconMedical, IconMessage, IconMonitor, IconMosquee, IconPackage, IconPhone, IconPin, IconPlane, IconRing, IconSettings, IconShieldCheck,
  IconSteering, IconTarget, IconTicket, IconTree, IconUsers, IconUtensils, IconWallet, IconWifi,
} from '../icons';

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

/**
 * STYLE DE L'APPLICATION CLIENTE (réglé une fois, au démarrage, par `definirStyle`).
 *
 *  - `icones` : 'volume' (objets rendus en 3D, comme dans l'app chauffeur et la console) ou
 *    'trait' (pictogrammes au trait, sans couleur, ceux du menu) pour toutes les icônes des
 *    listes : packs, urgences, lieux, compte. Les tuiles de l'accueil gardent leur volume.
 *  - `accueil` : 'couleur' (vert, blanc, violet), 'nb' (noir, gris, blanc : rendus/nb/), 'urbain'
 *    (base neutre, couleurs naturelles : rendus/urbain/) ou 'vif' (les mêmes objets et les mêmes
 *    couleurs que 'urbain', en plus saturé : rendus/vif/, produits par publier.py).
 *
 * Revenir à l'ancien accueil : `accueil: 'couleur'` dans src/main.tsx, rien d'autre.
 */
export interface StyleOrion { icones: 'volume' | 'trait' | 'ios'; accueil: 'couleur' | 'nb' | 'urbain' | 'vif' }
const style: StyleOrion = { icones: 'volume', accueil: 'couleur' };
export function definirStyle(s: Partial<StyleOrion>): void { Object.assign(style, s); }
const dossierAccueil = (): string => (style.accueil === 'couleur' ? '' : `${style.accueil}/`);

/** Objets des services de l'accueil. */
export type ObjetService =
  | 'food' | 'achat' | 'supermarche' | 'colis' | 'abonnement' | 'location' | 'mariage' | 'mes-courses' | 'aide'
  // Volet Services et compte (version 1.5.7) : calendrier, bouclier à croix, boîte cadeau.
  | 'reserver' | 'protection' | 'cadeau';

/** Icônes en volume des listes et des boutons (paramètres, urgences, packs, lieux). */
export type Icone3D =
  | 'pack-argent' | 'pack-or' | 'pack-diamant' | 'samu' | 'police' | 'pompiers'
  | 'reglages' | 'assurance' | 'historique' | 'alertes-sos' | 'portefeuille' | 'cadenas' | 'document' | 'serveur'
  | 'telephone' | 'message' | 'wifi' | 'lieu' | 'destination' | 'domicile' | 'bureau' | 'banque' | 'aeroport'
  | 'ecole' | 'eglise' | 'mosquee' | 'hotel' | 'carburant' | 'bus' | 'loisirs' | 'immeuble' | 'parc'
  // Outils de travail : app chauffeur, console, tableau de bord.
  | 'eco' | 'chauffeur' | 'clients' | 'finances' | 'objectif' | 'carte';

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
  if (peinture === 'accent') {
    if (caisse === 'suv') return 'suv-orion';
    return accent === 'vert' ? 'berline-orion' : (ACCENTS_RENDUS as string[]).includes(accent) ? `berline-${accent}` : 'berline-perle';
  }
  return `${caisse}-${peinture === 'bronze' ? 'argent' : peinture}`;
}

/** Image d'un rendu : dimensions fixées, pour que la page ne saute pas au chargement. */
function Rendu({ nom, largeur, ratio, classe = '' }: { nom: string; largeur: number; ratio: number; classe?: string }) {
  return (
    <img
      className={`vehicule ${classe}`.trim()} src={rendu(nom)} alt="" aria-hidden="true" draggable={false}
      width={Math.round(largeur)} height={Math.round(largeur * ratio)} decoding="async"
      // Objet absent de la palette d'accueil (vif/, urbain/…) : on montre son rendu de base.
      onError={(e) => {
        const img = e.currentTarget;
        const base = nom.replace(/^[a-z]+\//, '');
        if (base !== nom && !img.dataset['repli']) { img.dataset['repli'] = '1'; img.src = rendu(base); }
      }}
    />
  );
}

/** Voiture vue de trois quarts. `accueil` : la voiture de la tuile d'accueil (suit la palette de l'accueil). */
export function Voiture({ modele = 'berline', peinture = 'accent', largeur = 120, accueil = false }: {
  modele?: Modele; peinture?: Peinture; largeur?: number; phares?: boolean; accueil?: boolean;
}) {
  const accent = useAccentSur();
  const styleOrion = useStyleOrionSur();
  // Accueil (design 2.7) : la voiture à la couleur choisie (vert, bleu, orange) quand elle existe
  // en rendu ; sinon, et toujours en « Style Orion », celle de la palette d'accueil.
  if (accueil && style.accueil !== 'couleur' && (styleOrion || !(ACCENTS_RENDUS as string[]).includes(accent))) {
    return <Rendu nom={`${dossierAccueil()}berline-orion`} largeur={largeur} ratio={0.58} />;
  }
  return <Rendu nom={fichierVoiture(modele, peinture, accent)} largeur={largeur} ratio={0.58} />;
}

/** Scooter électrique de livraison, avec son coffre : le même objet qu'à l'accueil, partout où il apparaît. */
export function Scooter({ largeur = 120 }: { largeur?: number; accueil?: boolean }) {
  return <Rendu nom={`${dossierAccueil()}scooter`} largeur={largeur * 0.82} ratio={0.875} classe="scooter" />;
}

/** Chaque objet a son pictogramme au trait : même sens, sans couleur ni volume. */
const TRAITS: Record<ObjetService | Icone3D, (p: { size?: number; strokeWidth?: number }) => JSX.Element> = {
  food: IconUtensils, achat: IconBag, supermarche: IconCart, colis: IconPackage, abonnement: IconCrown, location: IconKey, mariage: IconRing,
  'mes-courses': IconCar, aide: IconHeadset, reserver: IconCalendar, protection: IconShieldCheck, cadeau: IconGift,
  'pack-argent': IconAward, 'pack-or': IconCrown, 'pack-diamant': IconGem, samu: IconMedical, police: IconBadge, pompiers: IconFlame,
  reglages: IconSettings, assurance: IconShieldCheck, historique: IconClock, 'alertes-sos': IconAlarm, portefeuille: IconWallet, cadenas: IconLock,
  document: IconFile, serveur: IconMonitor, telephone: IconPhone, message: IconMessage, wifi: IconWifi,
  lieu: IconPin, destination: IconFlag, domicile: IconHome, bureau: IconBriefcase, banque: IconBank, aeroport: IconPlane, ecole: IconEcole,
  eglise: IconEglise, mosquee: IconMosquee, hotel: IconLit, carburant: IconCarburant, bus: IconBus, loisirs: IconTicket, immeuble: IconBuilding, parc: IconTree,
  eco: IconLeaf, chauffeur: IconSteering, clients: IconUsers, finances: IconChart, objectif: IconTarget, carte: IconMap,
};

/**
 * Style « ios » : chaque pictogramme a sa couleur système Apple, celle qu'on lui donnerait
 * dans les Réglages d'un iPhone (rouge pour l'urgence, vert pour l'argent et la protection,
 * bleu pour les lieux et l'aide…). Le nom de la teinte renvoie à une variable `--ios-<teinte>`.
 */
export type TeinteIos = 'rouge' | 'orange' | 'jaune' | 'vert' | 'menthe' | 'sarcelle' | 'cyan' | 'bleu' | 'indigo' | 'violet' | 'rose' | 'brun' | 'gris';
const TEINTES: Record<ObjetService | Icone3D, TeinteIos> = {
  food: 'orange', achat: 'rose', supermarche: 'vert', colis: 'brun', abonnement: 'orange', location: 'indigo', mariage: 'rose',
  'mes-courses': 'bleu', aide: 'vert', reserver: 'rouge', protection: 'vert', cadeau: 'rose',
  'pack-argent': 'gris', 'pack-or': 'orange', 'pack-diamant': 'cyan', samu: 'rouge', police: 'bleu', pompiers: 'orange',
  reglages: 'gris', assurance: 'vert', historique: 'indigo', 'alertes-sos': 'rouge', portefeuille: 'sarcelle', cadenas: 'bleu',
  document: 'gris', serveur: 'indigo', telephone: 'vert', message: 'vert', wifi: 'bleu',
  lieu: 'rouge', destination: 'vert', domicile: 'bleu', bureau: 'brun', banque: 'vert', aeroport: 'bleu', ecole: 'orange',
  eglise: 'violet', mosquee: 'sarcelle', hotel: 'indigo', carburant: 'orange', bus: 'bleu', loisirs: 'rose', immeuble: 'gris', parc: 'vert',
  eco: 'vert', chauffeur: 'indigo', clients: 'bleu', finances: 'vert', objectif: 'rouge', carte: 'sarcelle',
};

/** Pictogramme blanc sur un carré arrondi de couleur saturée, comme les icônes des Réglages iOS. */
export function PastilleIos({ teinte, taille = 34, children }: { teinte: TeinteIos; taille?: number; children: ReactNode }) {
  return <span className="objet-ios" data-teinte={teinte} style={{ width: taille, height: taille }} aria-hidden="true">{children}</span>;
}

/**
 * Objet d'un service ou icône d'une liste. `volume` : toujours le rendu 3D (tuiles de
 * l'accueil), dans la palette de l'accueil. Sinon l'app cliente affiche le pictogramme
 * (au trait, ou blanc sur sa pastille de couleur en style « ios ») ; l'app chauffeur, la
 * console et le tableau de bord gardent l'objet en volume.
 */
export function Objet({ nom, taille = 96, volume = false }: { nom: ObjetService | Icone3D; taille?: number; volume?: boolean }) {
  if (volume) return <Rendu nom={`${dossierAccueil()}${nom}`} largeur={taille} ratio={1} classe="objet" />;
  if (style.icones === 'ios') {
    const Trait = TRAITS[nom];
    const cote = Math.max(24, Math.min(64, Math.round(taille)));
    return <PastilleIos teinte={TEINTES[nom]} taille={cote}><Trait size={Math.round(cote * 0.58)} strokeWidth={2.1} /></PastilleIos>;
  }
  if (style.icones === 'trait') {
    const Trait = TRAITS[nom];
    const cote = Math.max(18, Math.min(30, Math.round(taille * 0.78)));
    return <span className="objet-trait" style={{ width: taille, height: taille }} aria-hidden="true"><Trait size={cote} strokeWidth={1.9} /></span>;
  }
  return <Rendu nom={nom} largeur={taille} ratio={1} classe="objet" />;
}

/** Rendu vu de dessus de la couleur choisie (voiture verte, orange, bleue, ou nacrée pour les autres palettes). */
export const nomVoitureDessus = (accent: string): string =>
  accent === 'vert' ? 'voiture-dessus' : (ACCENTS_RENDUS as string[]).includes(accent) ? `voiture-dessus-${accent}` : 'voiture-dessus-perle';
/** Vue de dessus, pour le repère du véhicule sur la carte. */
export function VoitureDessus({ taille = 26 }: { taille?: number }) {
  const accent = useAccentSur();
  return <Rendu nom={nomVoitureDessus(accent)} largeur={taille} ratio={2} />;
}

/**
 * Tuile de service : l'objet en volume sur un carré arrondi, le nom dessous. `rang` décale
 * l'entrée et le flottement de l'objet, pour que les tuiles ne bougent pas toutes ensemble.
 * `ronde` : l'objet sur une pastille ronde à fond neutre (rangée de l'accueil, volet Services).
 */
export function Tuile({ objet, label, note, grande, ronde, off, rang = 0, onClick }: {
  objet: ReactNode; label: string; note?: string; grande?: boolean; ronde?: boolean; off?: boolean; rang?: number; onClick: () => void;
}) {
  return (
    <button className={`tuile${grande ? ' grande' : ''}${ronde ? ' ronde' : ''}${off ? ' off' : ''}`} style={{ '--i': rang } as CSSProperties} onClick={onClick} disabled={off}>
      <span className="tuile-fond">{objet}</span>
      <strong className="tuile-nom">{label}</strong>
      {note && <span className="tuile-note">{note}</span>}
    </button>
  );
}
