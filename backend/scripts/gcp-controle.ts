/**
 * Contrôle de la sécurité Google Cloud du projet, vu du serveur.
 *
 *   GCP_PROJECT_ID=<projet> npm run gcp:controle
 *
 * Avec l'identité du serveur (compte de service de l'instance, ou GOOGLE_APPLICATION_CREDENTIALS) :
 *  - API Keys : liste les clés d'API du projet et signale celles qui ne sont pas restreintes ;
 *  - Secret Manager : vérifie que chaque référence `sm://` de l'environnement est lisible
 *    (sans jamais afficher la valeur).
 * Sort avec le code 1 s'il reste une alerte : utilisable dans une vérification planifiée.
 */
import { AccesGoogle } from '../src/modules/gcp/acces.js';
import { auditerCles } from '../src/modules/gcp/cles.js';
import { lireSecret, referencesSecrets } from '../src/modules/gcp/secrets.js';

const acces = new AccesGoogle();
let alertes = 0;

console.log(`Projet : ${await acces.projet()}\n`);

console.log('Clés d’API');
try {
  const cles = await auditerCles(acces);
  if (cles.length === 0) console.log('  aucune clé');
  for (const c of cles) {
    console.log(`  ${c.alertes.length ? '✗' : '✓'} ${c.nom} — application : ${c.application} ; API : ${c.api.join(', ') || 'toutes'}`);
    for (const a of c.alertes) { alertes++; console.log(`      ${a}`); }
  }
} catch (e) {
  alertes++;
  console.log(`  contrôle impossible : ${e instanceof Error ? e.message : e}`);
  console.log('  (rôle « Lecteur de clés API » requis pour le compte qui lance ce contrôle)');
}

console.log('\nSecrets référencés par l’environnement');
const refs = referencesSecrets(process.env);
if (refs.length === 0) console.log('  aucune référence sm:// : les secrets sont dans les variables d’environnement elles-mêmes');
for (const ref of refs) {
  try {
    const v = await lireSecret(acces, ref);
    console.log(`  ✓ ${ref.variable} ← ${ref.secret} (version ${ref.version}, ${v.length} caractères)`);
  } catch (e) {
    alertes++;
    console.log(`  ✗ ${ref.variable} ← ${ref.secret} : ${e instanceof Error ? e.message : e}`);
  }
}

console.log(alertes ? `\n${alertes} alerte(s).` : '\nAucune alerte.');
process.exit(alertes ? 1 : 0);
