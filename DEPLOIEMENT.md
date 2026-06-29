# 🚀 Mettre ORION en ligne — guide pas à pas

Objectif : obtenir un **lien internet** que tu peux envoyer à des testeurs à Abidjan,
puis (plus tard) une **app installable** sur téléphone.

> Rappel : 2 morceaux à mettre en ligne — le **backend** (moteur) et le **frontend** (l'app).

---

## ⭐ Le plus simple : un lien démo à partager (sans backend)

L'app fonctionne en **mode démo** (données simulées) : il suffit de publier le **frontend**
pour obtenir un **lien cliquable** que tes connaissances peuvent ouvrir sur leur téléphone.

### Option 1 — GitHub Pages (gratuit, sur ton propre dépôt, automatique)
J'ai déjà ajouté le workflow `.github/workflows/deploy-pages.yml`. Une seule action de ta part :
1. Sur GitHub, va dans **Settings → Pages**.
2. **Build and deployment → Source** : choisis **« GitHub Actions »**.
3. (Si besoin) onglet **Actions** → ouvre « Deploy demo to GitHub Pages » → **Run workflow**.
4. Après ~2 min, ton lien est prêt :
   **`https://eliseeaguiei2018-pixel.github.io/orion-vtc-App/`** ← partage-le ! 🎉

> Le workflow se relance à chaque mise à jour. Si le déploiement est bloqué car la branche
> n'est pas `main`, fusionne la PR dans `main` (ou dis-le-moi, je t'explique).

### Option 2 — Vercel (gratuit, ~5 clics, lien le plus rapide)
1. Va sur **https://vercel.com** → **Continue with GitHub**.
2. **Add New → Project** → choisis `orion-vtc-App` → **Import**.
3. **Root Directory** : choisis **`frontend`**.
4. **Deploy**. Au bout d'une minute tu obtiens un lien `https://orion-xxx.vercel.app` à partager.

> Aucune des deux options ne nécessite le backend : la démo tourne toute seule.

---

## Niveau 2 — Lien web partageable

### Étape A · Mettre le backend en ligne (Render — gratuit pour tester)
1. Crée un compte sur **https://render.com** (connexion avec GitHub).
2. **New → Blueprint**, choisis ton dépôt `orion-vtc-App`.
3. Render détecte le fichier **`render.yaml`** à la racine et crée le service `orion-backend`.
4. Lance le déploiement. À la fin tu obtiens une URL, ex. `https://orion-backend.onrender.com`.
5. Vérifie : ouvre `https://orion-backend.onrender.com/health/ready` → tu dois voir `{"status":"ready"}`.

### Étape B · Mettre le frontend en ligne (Vercel — gratuit)
1. Crée un compte sur **https://vercel.com** (connexion avec GitHub).
2. **Add New → Project**, choisis `orion-vtc-App`.
3. **Root Directory** : sélectionne le dossier **`frontend`**.
4. Variable d'environnement à ajouter :
   - `VITE_API_URL` = l'URL de ton backend (ex. `https://orion-backend.onrender.com`)
5. Déploie. Tu obtiens un lien, ex. `https://orion.vercel.app` → **c'est ton app en ligne** 🎉

### Étape C · Sécuriser (recommandé)
- Sur Render, change `CORS_ORIGIN` pour mettre **l'URL exacte de ton front** (au lieu de `*`).
- En production réelle, mets `SIMULATE_RIDES=false` (quand l'app chauffeur fournira les vraies positions).

---

## Niveau 3 — Vraie app mobile (Play Store / App Store)

L'app actuelle est une **app web**. Pour la rendre installable et utiliser le **GPS** et les
**capteurs** (détection d'accident) du téléphone, on l'« emballe » avec **Capacitor** :

```bash
cd frontend
npm install @capacitor/core @capacitor/cli
npx cap init ORION ci.orion.app
npm run build
npx cap add android   # et/ou : npx cap add ios
npx cap open android   # ouvre Android Studio pour générer l'APK / publier
```

> La publication sur les stores nécessite un compte développeur (Google Play : ~25 $ une fois ;
> Apple : ~99 $/an). Je peux préparer toute la configuration Capacitor quand tu veux.

---

## Activer Google Maps (optionnel)
1. Obtiens une clé sur Google Cloud (APIs : Directions, Places, Maps JavaScript).
2. Backend : variable `GOOGLE_MAPS_API_KEY` (Render → Environment).
3. Frontend : variable `VITE_GOOGLE_MAPS_API_KEY` (Vercel → Environment).

Sans clé, ORION fonctionne avec sa carte stylisée et son calcul d'itinéraire interne.

---

## Aide
Un blocage ? Copie le message d'erreur (Render/Vercel affichent des logs) et envoie-le moi,
je te débloque.
