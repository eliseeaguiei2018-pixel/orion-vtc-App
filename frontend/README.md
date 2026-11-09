# ORION VTC — Application Client (premium)

Application **client** mobile-first (la première livrée). Pensée pour surpasser les apps
VTC du marché : interface premium, fluide, et adaptée à la Côte d'Ivoire (Abidjan).

Le projet contient trois pages Vite : **app cliente** (`index.html`), **console Admin**
(`admin.html`) et **app Chauffeur** (`driver.html`, code dans `src/driver/` — voir
[docs/10](../docs/10-app-chauffeur.md)). En dev : `http://localhost:5173/driver.html`.

## Points forts
- 🎨 **Design premium** : thème sombre émeraude, verre dépoli, halo lumineux, animations fluides.
- 🗺️ **Carte stylisée ORION** projetant de vraies coordonnées d'Abidjan (route, pins, véhicule animé) — fonctionne sans clé ; prête pour Google Maps.
- 💸 **Prix en FCFA (XOF)**, verrouillé avant validation, détail transparent.
- 📱 **Mobile money** en tête (Orange Money, Wave, MTN MoMo, Moov Money) + espèces + carte.
- 🛰️ **Suivi en direct** : marqueur véhicule animé, ETA, infos chauffeur.
- 🚨 **Bouton SOS** : alerte SAMU (185) + supervision, détection d'accident annoncée.
- ⭐ Parcours complet : onboarding → destination → estimation → confirmation → recherche → suivi → notation.

## Démarrage
```bash
cp .env.example .env   # optionnel
npm install
npm run dev            # http://localhost:5173
```
- Sans `VITE_API_URL`, l'app tourne en **mode démo** (données simulées) — idéale pour la revue de design.
- Avec `VITE_API_URL=http://localhost:3000`, elle consomme le backend ORION (estimation, SOS…).

## Scripts
| Commande | Description |
|----------|-------------|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production (`dist/`) |
| `npm run preview` | Prévisualiser le build |
| `npm run typecheck` | Vérification de types |

## Stack
React 18 · TypeScript · Vite · design system CSS sur-mesure (zéro framework UI) · icônes SVG inline.

## Structure
```
src/
  App.tsx            orchestration du parcours + écrans
  api.ts             client backend (avec repli mode démo)
  data.ts            lieux d'Abidjan, véhicules, chauffeurs, format FCFA
  types.ts           types partagés
  icons.tsx          jeu d'icônes SVG
  components/
    OrionMap.tsx     carte stylisée (projection coordonnées Abidjan)
    ui.tsx           TopBar, Sheet, Toast
  index.css          design system premium
```

## Prochaine étape
Brancher la passerelle WebSocket du backend (`/ws/rides/:id`) pour un suivi 100% temps réel
piloté par le serveur, et activer Google Maps via `VITE_GOOGLE_MAPS_API_KEY`.
