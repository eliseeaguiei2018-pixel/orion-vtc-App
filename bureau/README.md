# ORION — applications de bureau (Windows, macOS)

Deux applications de bureau, **séparées** : **ORION Console** et **ORION Tableau de bord**.
Elles permettent aux employés d'ORION de travailler depuis leur ordinateur, au bureau ou
à la maison, avec une icône dans la barre des tâches ou le Dock, une fenêtre dédiée et le
plein écran.

## Le principe : une enveloppe mince

Chaque application est une fenêtre (Electron) qui ouvre l'**application web ORION** à son
adresse. Il n'y a donc qu'**une seule** console à maintenir : une correction publiée sur
le site arrive dans l'application au lancement suivant, sans réinstaller. Et si une
application de bureau pose problème, la **même adresse s'ouvre dans n'importe quel
navigateur** (Chrome, Edge, Safari), avec les mêmes données.

C'est le même code web que les applications installables depuis le navigateur (voir
`frontend` et `DEPLOIEMENT.md`). Le bureau ajoute seulement : une fenêtre native, une
icône, un menu en français, un écran « connexion impossible » avec nouvel essai
automatique, et des verrous de sécurité.

## Sécurité

- La page n'a accès **ni à Node.js ni aux fichiers** du poste (`contextIsolation`,
  `sandbox`, pas de `nodeIntegration`). Vérifié : `typeof require === 'undefined'`.
- L'application ne navigue que dans les **adresses ORION** configurées. Tout autre lien
  (WhatsApp, `tel:`, `mailto:`) part vers le navigateur ou le téléphone du poste ; `file:`
  et les protocoles inconnus sont refusés.
- **Aucune permission sensible** : ni caméra, ni micro, ni position. Notifications et
  plein écran seulement, et seulement pour les adresses ORION.
- Deux applications **cloisonnées** : identifiants, noms et espaces de stockage distincts
  (`persist:orion-console` / `persist:orion-tableau`). La session et la clé d'appareil de
  l'une ne se mélangent jamais avec l'autre.
- Verrous Electron à la construction (`electronFuses`) : l'application ne peut pas être
  détournée en interpréteur Node.js, et ne charge que son propre code signé (ASAR scellé).

Au premier lancement, l'application demande le **code de synchronisation ORION** (comme
sur le web), puis les identifiants personnels de l'employé. Un appareil se révoque depuis
la console (section « Sessions actives »).

## Configurer les adresses

`orion.config.json` — remplacer par les vrais domaines avant de construire :

```json
{
  "console": { "url": "https://console.orion.ci/admin.html", "secours": [] },
  "tableau": { "url": "https://tableau.orion.ci/dashboard.html", "secours": [] }
}
```

`secours` : adresses essayées dans l'ordre si la principale ne répond pas.

## Lancer en développement

```bash
cd bureau
npm install
ORION_URL=http://localhost:4500/admin.html npm run console    # ou: npm run tableau
npm test                                                      # règles de sécurité
```

## Construire les applications

```bash
npm run dist:console     # installateur de la plateforme courante
npm run dist:tableau
```

- **Windows** : installateur `.exe` (x64 et ARM64).
- **macOS** : image disque `.dmg` universelle (Intel et Apple Silicon).
- **Linux** : `AppImage`.

Sur GitHub, le workflow **« Applications de bureau »** vérifie les règles et la
compilation à chaque modification de `bureau/`, et produit les installateurs Windows et
macOS sur demande (onglet Actions, ou `[bureau]` dans le message de commit).

### Signature (diffusion aux employés)

Sans certificat, les applications fonctionnent mais Windows affiche un avertissement
SmartScreen et macOS refuse l'ouverture par double-clic. Pour une vraie diffusion,
fournir à la construction (variables d'environnement ou secrets du dépôt) :

- **Windows** : `CSC_LINK`, `CSC_KEY_PASSWORD` (certificat de signature de code).
- **macOS** : `CSC_LINK`, `CSC_KEY_PASSWORD` (certificat « Developer ID Application »),
  puis `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` pour la notarisation.

## Vérifié en conditions réelles

Les deux applications ont été lancées (Electron, écran virtuel) de bout en bout :
enrôlement avec le code de synchronisation, connexion, ouverture de la console et du
tableau de bord, règles de navigation (lien externe confié au système, redirection hors
ORION bloquée), page isolée de Node.js, et écran « connexion impossible » quand le serveur
ne répond pas. L'application empaquetée démarre et refuse de s'exécuter en mode Node.
