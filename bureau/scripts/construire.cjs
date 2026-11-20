'use strict';
/**
 * Construit UNE application de bureau ORION : `console` ou `tableau`.
 *
 *   node scripts/construire.cjs console            installateur de la plateforme courante
 *   node scripts/construire.cjs tableau --dossier  application dépliée, sans installateur (essais)
 *
 * Windows : installateur .exe (x64 et ARM64). macOS : image disque .dmg universelle
 * (Intel et Apple Silicon). Linux : AppImage.
 *
 * SIGNATURE. Sans certificat, les applications fonctionnent mais Windows affiche un
 * avertissement SmartScreen et macOS refuse l'ouverture par double-clic. Pour une
 * diffusion aux employés, fournir à la construction :
 *   - Windows : CSC_LINK et CSC_KEY_PASSWORD (certificat de signature de code) ;
 *   - macOS : CSC_LINK, CSC_KEY_PASSWORD (certificat « Developer ID Application »),
 *     puis APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD et APPLE_TEAM_ID pour la notarisation.
 */
const path = require('node:path');
const builder = require('electron-builder');
const { application } = require('../src/applications.cjs');

const id = process.argv[2];
const APP = application(id);
const deplie = process.argv.includes('--dossier');
const signe = Boolean(process.env.CSC_LINK);
const notarise = Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);

const config = {
  appId: APP.appId,
  productName: APP.nom,
  copyright: 'ORION',
  directories: { output: path.join('dist', id), buildResources: 'ressources' },
  files: ['src/**', 'ressources/**', 'orion.config.json', 'package.json'],
  // L'identité de l'application est inscrite dans le paquet : une application installée
  // ne lit aucune variable d'environnement pour savoir qui elle est ni où elle va.
  extraMetadata: { name: `orion-${id}`, productName: APP.nom, orion: { app: id } },
  icon: path.join('ressources', `${APP.icone}.png`),
  asar: true,
  publish: null,
  // Verrous d'Electron : l'application ne peut pas être détournée en interpréteur Node.js
  // ni chargée avec un autre code que le sien.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
    artifactName: `ORION-${id}-\${version}-windows-\${arch}.\${ext}`,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: APP.nom,
    installerLanguages: ['fr_FR'],
    language: '1036',
    artifactName: `ORION-${id}-\${version}-windows.\${ext}`,
  },
  mac: {
    target: [{ target: 'dmg', arch: ['universal'] }],
    category: 'public.app-category.business',
    artifactName: `ORION-${id}-\${version}-macos.\${ext}`,
    hardenedRuntime: true,
    // Pas de certificat : construction non signée, pour les essais.
    identity: signe ? undefined : null,
    notarize: notarise,
  },
  linux: {
    target: ['AppImage'],
    category: 'Office',
    artifactName: `ORION-${id}-\${version}-linux.\${ext}`,
  },
};

builder.build({ config, dir: deplie, publish: 'never' })
  .then((fichiers) => { console.log(`${APP.nom} :`); for (const f of fichiers) console.log('  ', f); })
  .catch((e) => { console.error(e); process.exit(1); });
