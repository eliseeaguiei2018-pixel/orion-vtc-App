import { useI18n, type Lang } from '../i18n';
import { TEXTES } from './langues';

/**
 * Traductions de l'app Chauffeur — mêmes 8 langues que l'app cliente, même choix
 * mémorisé (« orion.lang ») : un téléphone partagé garde la langue choisie.
 *
 * Le texte français sert de clé : le code reste lisible en français, et toute phrase
 * pas encore traduite s'affiche en français au lieu d'une clé technique.
 * Les variables s'écrivent {0}, {1}… (ou {nom}) et se remplacent à l'affichage.
 */
const COLONNES: Lang[] = ['fr', 'en', 'es', 'it', 'ar', 'zh', 'de', 'ru'];
const LOCALES: Record<Lang, string> = {
  fr: 'fr-FR', en: 'en-GB', es: 'es-ES', it: 'it-IT', ar: 'ar-u-nu-latn', zh: 'zh-CN', de: 'de-DE', ru: 'ru-RU',
};

let courante: Lang = 'fr';
const tables = new Map<Lang, Map<string, string>>();

function table(l: Lang): Map<string, string> {
  let t = tables.get(l);
  if (!t) {
    const i = COLONNES.indexOf(l);
    t = new Map();
    for (const ligne of TEXTES) if (ligne[i]) t.set(ligne[0], ligne[i]!);
    tables.set(l, t);
  }
  return t;
}

export type Variables = ReadonlyArray<string | number | null | undefined> | Record<string, string | number | null | undefined>;

/** Traduit un texte (écrit en français) dans la langue choisie par le chauffeur. */
export function tr(fr: string, vars?: Variables): string {
  const s = courante === 'fr' ? fr : table(courante).get(fr) ?? fr;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = (vars as Record<string, string | number | null | undefined>)[k];
    return v === undefined || v === null ? m : String(v);
  });
}

/**
 * Marque un texte français gardé tel quel dans les données (motifs envoyés à la console,
 * libellés de listes) mais traduit au moment de l'affichage avec tr(). Sert aussi au
 * contrôle automatique des traductions (npm run check:langues).
 */
export const aTraduire = (fr: string): string => fr;

/** Choisit la langue d'affichage (appelé par la racine de l'app à chaque rendu). */
export function definirLangue(l: Lang): void { courante = l; }
export const langueCourante = (): Lang => courante;
/** Locale des dates (chiffres latins partout, comme les montants). */
export const localeCourante = (): string => LOCALES[courante];

/**
 * Libellés fixes (gammes, statuts, moyens de paiement…) : l'objet reste en français
 * dans le code et chaque valeur lue est traduite au moment de l'affichage.
 */
export function libelles<T extends Record<string, string>>(objet: T): T {
  return new Proxy(objet, {
    get(cible, cle, recepteur) {
      const v = Reflect.get(cible, cle, recepteur) as unknown;
      return typeof v === 'string' ? tr(v) : v;
    },
  });
}

/** Racine de l'app : synchronise la langue partagée avec les traductions chauffeur. */
export function useLangueChauffeur() {
  const i18n = useI18n();
  definirLangue(i18n.lang);
  return i18n;
}
