# 15. Graphisme premium et fluidité des quatre interfaces

Un palier de finition commun à l'app cliente, l'app Chauffeur, la console et le tableau
de bord. Volontairement **additif** : on affine le rendu sans refaire des interfaces déjà
dessinées, pour ne rien casser.

## Typographie

- **Polices variables** Sora (titres) et Inter (texte), avec **taille optique**
  (`font-optical-sizing: auto`) : les graisses sont continues et le dessin des lettres
  s'ajuste à la taille. Rendu plus fin et plus « épuré » qu'avec des graisses fixes.
- **Lissage et lisibilité** sur toutes les pages : `-webkit-font-smoothing: antialiased`,
  `text-rendering: optimizeLegibility`, crénage et ligatures activés.
- **Chiffres alignés** (`tabular-nums`) sur les montants, compteurs, heures et
  statistiques : les colonnes ne tremblent plus quand les valeurs changent (finances,
  KPI, horloge, codes).

Fichier : `frontend/src/premium.css`, importé par les quatre interfaces.

## Fluidité

- **Taux de rafraîchissement élevé** : sur Android, les deux apps demandent le mode
  d'écran le plus rapide (90/120/144 Hz, dalles LTPO) ; sur iOS, ProMotion est autorisé
  (`CADisableMinimumFrameDurationOnPhone`). Voir documents 10 et 14.
- **Animations composées par le GPU** (transform, opacity) : elles tiennent le plein taux
  de l'écran sans saccade.
- **« Moins d'animations »** : si la personne l'a demandé dans son système (accessibilité,
  mal des transports en voiture), transitions et animations sont coupées partout, écran de
  véhicule compris (`prefers-reduced-motion`).
- **Défilement souple** avec inertie tactile dans les zones défilantes.

## Diagnostic de fluidité (preuve)

Ouvrir n'importe quelle interface avec **`?fps=1`** affiche un badge qui mesure les images
par seconde réellement rendues et la crête atteinte. Sur un écran 60 Hz il plafonne à 60 ;
sur un écran 120/144 Hz il peut afficher ~120/144. C'est la preuve visible que la chaîne
graphique tire parti des dalles rapides. Inactif sans le paramètre (aucun coût en usage
normal). Fichier : `frontend/src/fps.ts`.

## Limite franche

Un vrai 120/144 Hz **ne se prouve pas sur un serveur sans écran** : en environnement de
rendu sans dalle, le badge plafonne à 60. Le code demande partout le meilleur taux ; la
fréquence réellement obtenue dépend de l'appareil, de sa dalle et de ses arbitrages
d'énergie. Sur un téléphone ou un écran de véhicule 120 Hz, l'amélioration est visible à
l'œil ; elle ne peut pas être capturée ici en image fixe.
