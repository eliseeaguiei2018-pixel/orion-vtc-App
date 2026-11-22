// Construit l'app native « ORION Console » (Android) à partir de la console web.
//
//   node scripts/construire-app-console.mjs            → app web dans dist-console
//   node scripts/construire-app-console.mjs android    → + copie dans console/android
//
// La console d'administration (admin.html) devient la page d'accueil (index.html) de
// l'application, avec son propre identifiant (ci.orion.console). Elle se connecte au serveur
// ORION désigné par VITE_API_URL (modifiable dans l'app, écran de connexion).
import { execFileSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const racine = join(import.meta.dirname, '..');
const env = { ...process.env, ORION_APP: 'console' };
const lancer = (cmd, args) => execFileSync(cmd, args, { cwd: racine, env, stdio: 'inherit', shell: process.platform === 'win32' });

lancer('npx', ['vite', 'build']);
const sortie = join(racine, 'dist-console');
renameSync(join(sortie, 'admin.html'), join(sortie, 'index.html'));
console.log('Console web prête : dist-console/index.html');

for (const plateforme of process.argv.slice(2)) {
  if (plateforme !== 'android') throw new Error(`Plateforme non prévue pour la console : ${plateforme}`);
  const existe = existsSync(join(racine, 'console', plateforme));
  lancer('npx', ['cap', existe ? 'sync' : 'add', plateforme]);
}
