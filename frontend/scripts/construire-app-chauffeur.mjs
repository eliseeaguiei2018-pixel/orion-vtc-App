// Construit l'app native « ORION Chauffeur » (Android / iOS) à partir de l'app web.
//
//   node scripts/construire-app-chauffeur.mjs            → app web dans dist-chauffeur
//   node scripts/construire-app-chauffeur.mjs android    → + copie dans chauffeur/android
//   node scripts/construire-app-chauffeur.mjs ios        → + copie dans chauffeur/ios
//
// L'app chauffeur (driver.html) devient la page d'accueil (index.html) de l'application,
// avec son propre identifiant (ci.orion.chauffeur), distinct de l'app cliente.
import { execFileSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const racine = join(import.meta.dirname, '..');
const env = { ...process.env, ORION_APP: 'chauffeur' };
const lancer = (cmd, args) => execFileSync(cmd, args, { cwd: racine, env, stdio: 'inherit', shell: process.platform === 'win32' });

lancer('npx', ['vite', 'build']);
const sortie = join(racine, 'dist-chauffeur');
renameSync(join(sortie, 'driver.html'), join(sortie, 'index.html'));
console.log('App web chauffeur prête : dist-chauffeur/index.html');

for (const plateforme of process.argv.slice(2)) {
  if (!['android', 'ios'].includes(plateforme)) throw new Error(`Plateforme inconnue : ${plateforme}`);
  // Premier passage : création du projet natif ; ensuite, simple synchronisation.
  const existe = existsSync(join(racine, 'chauffeur', plateforme));
  lancer('npx', ['cap', existe ? 'sync' : 'add', plateforme]);
}
