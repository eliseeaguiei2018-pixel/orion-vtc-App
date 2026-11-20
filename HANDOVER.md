# 📘 ORION — Cahier de reprise (Handover)

Ce document sert à **transmettre le projet** à une équipe (développeurs, designer, DevOps)
pour **matérialiser** ORION : mise en production, publication sur les stores, intégrations
réelles (paiement, cartes). Il décrit **ce qui est fait**, **où se trouve quoi**, **ce qui
reste**, les **comptes à créer** et **les profils à recruter**.

> ORION = super-app de mobilité verte pour Abidjan (Côte d'Ivoire) : **Course** (VTC) +
> **Livraison moto**, avec 3 interfaces (Client, Admin/supervision SAMU, et l'app Chauffeur à venir).

---

## 1. Vue d'ensemble technique

| Brique | Techno | Dossier |
|--------|--------|---------|
| **App Client** (passagers) | React + Vite + TypeScript | `frontend/` (page `index.html`) |
| **Console Admin / SAMU** | React (même projet, page séparée) | `frontend/admin.html` + `frontend/src/admin/` |
| **API Backend** | Node.js + Fastify + TypeScript | `backend/` |
| **App Chauffeur** | *à créer* (même stack conseillée) | — |

- **Langage unique : TypeScript** (client + admin + backend) → un dev full-stack couvre tout.
- **Temps réel** : WebSocket (suivi course/livraison).
- **Persistance** : couche `Repository` (mémoire → SQLite → **PostgreSQL** en prod, même interface).
- **Tests** : ~57 tests backend (node:test) ; `npm test`.
- **Déploiement prêt** : Vercel (front), Render (back) — cf. `DEPLOIEMENT.md`.

---

## 2. Carte des fichiers **DESIGN** (pour designer & dev front)

Tout le design est **centralisé et modifiable** — rien n'est figé.

| Ce que tu veux changer | Fichier | Comment |
|------------------------|---------|--------|
| **Couleurs, thème clair/sombre, ombres, rayons** | `frontend/src/index.css` (bloc `:root`) | Variables CSS (`--green`, `--green-bright`, `--surface`…). Changer 1 valeur = toute l'app suit. |
| **Illustrations des services** (voiture, moto, food, colis…) | `frontend/src/components/Illustrations.tsx` | SVG vectoriels. Modifier couleurs/formes, ou **remplacer** par des assets Figma/PNG/Lottie. |
| **Logo ORION** (feuille + étoiles) | `frontend/src/components/Logo.tsx` + `frontend/public/orion-icon.svg` | Pictogramme, icône d'app, favicon. |
| **Icônes de l'interface** | `frontend/src/icons.tsx` | Jeu d'icônes SVG cohérent. |
| **Écrans de l'app client** | `frontend/src/App.tsx` | Chaque écran = un composant nommé (`HomeScreen`, `DeliveryScreen`, `TrackingScreen`…). |
| **Carte / map** | `frontend/src/components/OrionMap.tsx` + `RealMap.tsx` + `mapConfig.ts` | Carte stylisée + branchement tuiles réelles (Google/OSM). |
| **Console Admin (style)** | `frontend/src/admin/admin.css` | Thème « salle de contrôle » séparé. |
| **Textes / langues (8 langues)** | `frontend/src/i18n/translations.ts` | Toutes les chaînes, par langue. |

**Workflow designer ↔ dev :** le designer maquette (Figma) et fournit les assets ;
le dev remplace l'asset ou ajuste les variables/composants. Faible risque, rapide.

---

## 3. Ce qui est **FAIT** ✅

- App **Client** complète : hub multi-services, **Course** (niveaux Bronze→Diamant, prix
  justifié TVA 5 % + frais 10 %, multi-arrêts, programmation), **Livraison moto**, suivi
  temps réel, appel chauffeur via internet, paiement mobile money (redirection opérateur),
  **historique + reçus**, **aide**, portefeuille, **ORION Assurance**, **biométrie**,
  **contact de confiance / partage**, **SOS + détection d'accident → SAMU 185**, 8 langues,
  thème clair/sombre.
- **Console Admin & supervision SAMU** : KPIs, carte flotte temps réel, file d'alertes,
  courses, chauffeurs/KYC, **écran de connexion** (jeton).
- **Backend** complet : courses, tarification, matching, temps réel, sécurité, portefeuille,
  assurance, admin — testé, 0 vulnérabilité.
- **Docs** : `DEPLOIEMENT.md`, `SECURITY.md`, `NATIVE.md`, `GUIDE_DEMARRAGE.md`, `docs/`.

---

## 4. Ce qui **RESTE** pour la mise en production ⏳

| Chantier | Détail | Profil concerné |
|----------|--------|-----------------|
| **Authentification réelle** | OTP → **JWT** + rôles (aujourd'hui l'API fait confiance au clientId). *Priorité sécurité n°1.* | Dev back |
| **Base de données prod** | Brancher **PostgreSQL** (interface Repository déjà prête). | Dev back / DevOps |
| **Hébergement + domaine** | Déployer (Render + Vercel), acheter `orion.ci` + `admin.orion.ci`, DNS/HTTPS. | DevOps / dev full-stack |
| **Cartes réelles** | Clé **Google Maps** (ou OSM/MapTiler) — couche déjà prête. | Dev front |
| **Paiement mobile money** | **Contrats marchands** Wave/Orange Money/MTN/Moov + intégration de leurs API. | Dev back + toi (contrats) |
| **Publication stores** | Emballage natif (**Capacitor**), comptes **Apple** (99 $/an) + **Google Play** (25 $), fiches, captures. | Dev mobile |
| **App Chauffeur** | 3ᵉ interface (réception/acceptation courses, navigation, gains). | Dev full-stack / mobile |
| **Design pro (option)** | Illustrations 3D, affinage visuel, motion design. | Designer / illustrateur |
| **Conformité** | RGPD / **ARTCI**, CGU, mentions légales, politique de confidentialité. | Juriste (ponctuel) |
| **Qualité & montée en charge** | Tests E2E, monitoring, sauvegardes, tests de charge. | Dev / DevOps / QA |

---

## 5. Comptes & prérequis à créer (côté ORION)

- **GitHub** (déjà : le dépôt).
- **Render** (backend) + **Vercel** (frontend) — comptes gratuits pour démarrer.
- **Nom de domaine** `orion.ci` (+ sous-domaine `admin.orion.ci`).
- **Google Cloud** (Maps) — carte bancaire pour la facturation.
- **Comptes marchands mobile money** : Wave, Orange Money, MTN MoMo, Moov Money.
- **Apple Developer Program** (99 $/an) + **Google Play Console** (25 $ une fois).
- **Boîte e-mail pro** (ex. `support@orion.ci`, `security@orion.ci`).

---

## 6. 👥 Profils à recruter (pour matérialiser ORION)

### Priorité 1 — le socle
**Développeur Full-Stack JavaScript/TypeScript (senior)** — *la personne clé.*
- Maîtrise : **React**, **Node.js/Fastify**, **PostgreSQL**, **Git/GitHub**, déploiement Vercel/Render.
- **Capacitor** (emballage iOS/Android) et notions **DevOps** (domaine, DNS, HTTPS, variables d'env).
- Rôle : déploiement réel, base de données, auth JWT, cartes, publication stores, app Chauffeur.
- 👉 Peut couvrir **~80 %** du travail à lui seul.

### Priorité 2 — renforts (souvent à temps partiel / ponctuels)
| Profil | Pourquoi | Quand |
|--------|----------|-------|
| **Dev mobile** (Capacitor/React Native, iOS & Android) | Publication stores, notifications push, biométrie native, suivi arrière-plan | Au moment de sortir les apps |
| **Intégrateur paiements** | Brancher les API Wave/OM/MTN/Moov (souvent fait par le full-stack une fois les contrats signés) | Quand les contrats mobile money sont obtenus |
| **DevOps / Cloud** (mi-temps) | Mise à l'échelle, monitoring, sauvegardes, sécurité serveur | Avant/juste après le lancement |
| **UI/UX Designer + Illustrateur** | Affiner le visuel, illustrations 3D premium, motion design | En parallèle, dès que possible |
| **QA / testeur** | Tests bout-en-bout, non-régression, recette | Avant chaque grosse sortie |
| **Juriste (conseil ponctuel)** | RGPD/ARTCI, CGU, contrats partenaires | Avant lancement public |

### Recommandation de démarrage
Commence par **1 développeur Full-Stack TS senior** (freelance de confiance ou petite
agence à Abidjan). Ajoute **plus tard** un **dev mobile** pour les stores, puis
l'**intégration paiement** quand les contrats sont là. Un **designer** peut intervenir en
parallèle sur le visuel.

### Mini-test d'embauche (pour vérifier un candidat)
1. « Explique-moi l'architecture » → doit parler de React (client+admin), Fastify (API), Capacitor, couche carte, couche paiement, Repository/PostgreSQL.
2. « Lance le projet en local et déploie une démo » → doit y arriver grâce à `GUIDE_DEMARRAGE.md` / `DEPLOIEMENT.md`.
3. « Ajoute un petit écran ou endpoint » → vérifier la qualité (TypeScript strict, tests, respect du design system).

---

## 7. Par où commencer (ordre conseillé)
1. Recruter le **dev full-stack**.
2. **Déploiement démo** (Render + Vercel + `VITE_MAP_PROVIDER=osm`) → voir l'app en ligne.
3. **PostgreSQL** + **auth JWT** (solidité & sécurité).
4. **Contrats mobile money** (toi) + intégration paiement.
5. **Domaine** + `admin.orion.ci`.
6. **Publication stores** (dev mobile).
7. **App Chauffeur**.
8. Design pro en continu.

---

*Base livrée par la phase de conception : code + design cohérents, testés et documentés.
L'équipe **affine et branche le réel** — elle ne repart pas de zéro.*
