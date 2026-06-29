# 🚀 Guide de démarrage ORION — pour débuter de zéro

Ce guide est écrit **pour quelqu'un qui n'a jamais codé**. Suis-le ligne par ligne.
Tu n'as **rien à copier-coller du code** : tout est déjà sauvegardé dans ton dépôt GitHub.

---

## 1. Comprendre ce que tu as (en 30 secondes)

Ton application est faite de **2 morceaux** :

| Dossier | C'est quoi ? | Rôle |
|---------|-------------|------|
| `backend/` | Le **moteur** (invisible) | Calcule les prix, trouve les chauffeurs, gère paiements & alertes SAMU |
| `frontend/` | L'**écran** (ce que voit l'utilisateur) | L'application que la personne utilise |

C'est **normal** d'avoir deux dossiers. Les deux se parlent entre eux.

---

## 2. Ce qu'il te faut (une seule fois)

1. **Un ordinateur** (Windows, Mac ou Linux).
2. **Node.js** — c'est gratuit et c'est le seul outil à installer.
   - Va sur **https://nodejs.org**
   - Télécharge la version **LTS** (le gros bouton vert)
   - Installe-la (Suivant → Suivant → Terminer)
3. **Git** (pour télécharger le code) — https://git-scm.com (souvent déjà installé sur Mac/Linux).

> 💡 Pour vérifier que Node est installé : ouvre un **terminal** (voir encadré plus bas)
> et tape `node --version`. Si un numéro s'affiche (ex. `v22.x`), c'est bon ✅.

<details>
<summary>📟 C'est quoi un « terminal » ?</summary>

C'est une fenêtre où on tape des commandes au lieu de cliquer.
- **Windows** : menu Démarrer → tape « **PowerShell** » → Entrée.
- **Mac** : Spotlight (loupe en haut à droite) → tape « **Terminal** » → Entrée.
- **Linux** : raccourci `Ctrl + Alt + T`.
</details>

---

## 3. Télécharger le code sur ton ordinateur (une seule fois)

Dans le terminal, tape (remplace l'adresse par celle de ton dépôt GitHub) :

```bash
git clone https://github.com/eliseeaguiei2018-pixel/orion-vtc-App.git
cd orion-vtc-App
```

> Ton code est sur la branche de travail. Pour récupérer exactement ce qui a été fait :
> ```bash
> git checkout claude/orion-platform-overview-osgd1u
> ```

---

## 4. Lancer l'application (le plus simple)

J'ai préparé un script qui **installe et démarre tout** pour toi.

### Sur Mac / Linux
```bash
./start.sh
```

### Sur Windows
Double-clique sur **`start.bat`**, ou dans PowerShell :
```powershell
.\start.bat
```

Au premier lancement, ça installe les pièces nécessaires (ça peut prendre 1–2 minutes).
Ensuite, ça démarre les deux morceaux. Tu verras s'afficher :

- L'app cliente : **http://localhost:5173** ← **ouvre ce lien dans ton navigateur** 🎉
- Le moteur (backend) : http://localhost:3000

Pour **arrêter**, reviens dans le terminal et fais `Ctrl + C`.

---

## 5. Lancer « à la main » (si le script ne marche pas)

Ouvre **deux** terminaux.

**Terminal 1 — le moteur :**
```bash
cd backend
npm install      # seulement la 1re fois
npm run dev
```

**Terminal 2 — l'app cliente :**
```bash
cd frontend
npm install      # seulement la 1re fois
npm run dev
```

Puis ouvre **http://localhost:5173**.

> ℹ️ L'app cliente fonctionne **même sans le backend** (mode démo, données simulées).
> Si tu veux qu'elle utilise le vrai moteur, crée un fichier `frontend/.env` avec :
> `VITE_API_URL=http://localhost:3000`

---

## 6. Et après ? Les 3 niveaux pour « avoir une vraie app »

```
Niveau 1 — La voir tourner sur TON ordi          ✅ (étapes ci-dessus)
Niveau 2 — Un lien internet partageable           → "déploiement" (hébergement)
Niveau 3 — Une app installable Play Store/App Store→ "emballage mobile" (Capacitor)
```

### Niveau 2 — Mettre en ligne (pour des testeurs à Abidjan)
On héberge gratuitement/à bas coût :
- le **frontend** sur **Vercel** ou **Netlify** (glisser-déposer le projet),
- le **backend** sur **Render** ou **Railway**.

Tu obtiens un **lien web** que tu peux envoyer à n'importe qui.

### Niveau 3 — Une vraie app mobile (Play Store / App Store)
L'app actuelle est une **app web**. Pour la rendre installable sur téléphone, on
l'« emballe » avec un outil (**Capacitor**). Ça permet aussi d'utiliser le **GPS** et
les **capteurs** (détection d'accident) du téléphone.

> 👉 Je peux faire le Niveau 2 et/ou le Niveau 3 pour toi quand tu veux — dis-moi.

---

## 7. Questions fréquentes

**« Je dois copier-coller le code ? »**
Non, jamais. Le code vit dans GitHub. Tu le `git clone` une fois, c'est tout.

**« Je dois comprendre le code pour le lancer ? »**
Non. Les commandes ci-dessus suffisent.

**« J'ai modifié un truc, comment je le sauvegarde ? »**
```bash
git add -A
git commit -m "ma modification"
git push
```

**« Ça a planté, qu'est-ce que je fais ? »**
Copie le message d'erreur affiché dans le terminal et envoie-le moi — je te dis quoi faire.
