'use strict';
/**
 * Seul pont entre l'application de bureau et la page : trois informations en lecture
 * seule. La page n'a accès ni à Node.js ni au système de fichiers.
 */
const { contextBridge } = require('electron');

const argument = (nom) => (process.argv.find((a) => a.startsWith(`--orion-${nom}=`)) || '').split('=')[1] || '';

contextBridge.exposeInMainWorld('orionBureau', Object.freeze({
  application: argument('app'),
  version: argument('version'),
  plateforme: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
}));
