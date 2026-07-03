# orion-vtc-App

Application VTC mobilité verte avec trois interfaces : client, chauffeur et admin.

## Obtenir un lien partageable depuis le code GitHub

L'objectif est de déployer l'application pour obtenir une URL publique (exemple : `https://mon-app.vercel.app`) à partager.

### 1) Identifier le type de projet

Avant de déployer, vérifiez la stack du dépôt :

- `package.json` + dossier `src/` → souvent web React/Vite/Next.js.
- Backend Node (`express`, `nestjs`) → API.
- Frontend + backend dans le même dépôt → fullstack.
- Projet mobile natif (Flutter/React Native) → lien de partage différent (build store/preview).

### 2) Choisir la plateforme

- **Frontend web** : Vercel ou Netlify.
- **API backend** : Render, Railway ou Fly.io.
- **Site statique** : GitHub Pages.
- **Fullstack** : frontend sur Vercel/Netlify + backend sur Render/Railway/Fly.io.

### 3) Connecter GitHub à la plateforme

1. Créer un compte sur la plateforme choisie.
2. Cliquer sur **New Project** / **Import from GitHub**.
3. Sélectionner ce dépôt `eliseeaguiei2018-pixel/orion-vtc-App`.
4. Autoriser l'accès GitHub si demandé.

### 4) Configurer le déploiement

Renseigner les paramètres demandés :

- **Build command** (exemples) : `npm run build`
- **Start command** (backend) : `npm start`
- **Output directory** (frontend statique) : `dist` ou `build`
- **Variables d'environnement** : clés API, URL DB, tokens (ne pas les committer)

### 5) Lancer le déploiement

- Lancer le premier déploiement.
- À la fin, la plateforme fournit une URL publique.
- Cette URL est le **lien partageable**.

### 6) Vérifier et partager

- Ouvrir l'URL et tester les parcours clés (connexion, réservation, espace chauffeur/admin).
- Partager le lien au format :
  - `https://votre-app.vercel.app`
  - `https://votre-backend.onrender.com`

## Bonnes pratiques

- Utiliser les secrets de la plateforme pour les variables sensibles.
- Activer les déploiements automatiques sur chaque push GitHub.
- Ajouter un domaine personnalisé plus tard si nécessaire.
