/**
 * STYLE DE L'APPLICATION — « Style Orion » ou design 2.7 (Apple).
 *
 * Le dessin du design 2.7 (apple.css : pastilles d'icônes, verre, capsules, mouvement) est
 * une couche posée par-dessus le style ORION 2.6 : il ne restructure rien. On le charge donc
 * comme une feuille à part, qu'on allume ou qu'on éteint à chaud. « Style Orion » activé = la
 * feuille est éteinte : l'app retrouve le dessin de la version 2.6.0 (icônes au trait, tuiles)
 * avec les tons de la 2.7 (couleurs.css, toujours actif : blanc pur, couleurs saturées).
 *
 * Le choix est mémorisé sur le téléphone (clé `orion.style`) et appliqué dès le démarrage,
 * avant le premier affichage. Par défaut : le design 2.7.
 */
import cssApple from './apple.css?inline';

export type StyleApp = 'apple' | 'orion';
const CLE = 'orion.style';
let feuille: HTMLStyleElement | null = null;

export function styleInitial(): StyleApp {
  try { return localStorage.getItem(CLE) === 'orion' ? 'orion' : 'apple'; } catch { return 'apple'; }
}

export function memoriserStyle(s: StyleApp): void {
  try { localStorage.setItem(CLE, s); } catch { /* stockage indisponible */ }
}

/** Allume (design 2.7) ou éteint (Style Orion) la couche apple.css. */
export function appliquerStyle(s: StyleApp): void {
  if (typeof document === 'undefined') return;
  if (!feuille) {
    feuille = document.createElement('style');
    feuille.id = 'style-apple';
    feuille.textContent = cssApple;
    document.head.appendChild(feuille);
    // La couche doit rester la DERNIÈRE feuille : si une autre est ajoutée ensuite (styles
    // chargés à la demande), on la remet au bout pour qu'elle garde la priorité.
    new MutationObserver(() => {
      if (feuille && document.head.lastElementChild !== feuille && [...document.head.children].some((n, i, t) =>
        i > t.indexOf(feuille as Element) && (n.tagName === 'STYLE' || (n.tagName === 'LINK' && (n as HTMLLinkElement).rel === 'stylesheet')))) {
        document.head.appendChild(feuille);
      }
    }).observe(document.head, { childList: true });
  }
  feuille.media = s === 'apple' ? 'all' : 'not all';
  document.documentElement.setAttribute('data-style', s);
}
