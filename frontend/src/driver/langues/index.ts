import { COMMUN } from './commun';
import { CONDUITE } from './conduite';
import { EQUIPE } from './equipe';
import { GESTION } from './gestion';
import { NAVIGATION } from './navigation';
import { VEHICULE } from './vehicule';
import { SALARIE } from './salarie';
import { ARRIERE_PLAN } from './arriereplan';
import { LIVRAISON } from './livraison';
import { CARTE } from './carte';
import { METEO } from './meteo';

/**
 * Tables de traduction de l'app Chauffeur, une ligne par phrase :
 * [français, anglais, espagnol, italien, arabe, chinois, allemand, russe].
 * Une case absente retombe sur le français (noms de marque, unités…).
 */
export type Ligne = readonly [fr: string, en?: string, es?: string, it?: string, ar?: string, zh?: string, de?: string, ru?: string];

export const TEXTES: Ligne[] = [...COMMUN, ...CONDUITE, ...GESTION, ...EQUIPE, ...NAVIGATION, ...VEHICULE, ...SALARIE, ...ARRIERE_PLAN, ...LIVRAISON, ...CARTE, ...METEO];
