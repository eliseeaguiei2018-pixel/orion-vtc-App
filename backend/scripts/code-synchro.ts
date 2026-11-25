import { createInterface } from 'node:readline';
import { empreinteCodeSynchro, verifierCodeSynchro } from '../src/modules/appareils/code.js';

/**
 * Produit l'EMPREINTE du code de synchronisation ORION, à placer dans la variable
 * d'environnement ORION_CODE_SYNCHRO_EMPREINTE du serveur (Render, Docker…).
 *
 *   npm run code-synchro            puis taper le code (il ne s'affiche pas)
 *   echo "le code" | npm run code-synchro --silent
 *
 * Le code n'est jamais écrit sur le disque ni passé en argument (il resterait dans
 * l'historique du terminal). Seule l'empreinte sort : elle ne permet pas de retrouver
 * le code. Pour changer de code, relancer le script et remplacer la variable : les
 * appareils déjà enrôlés gardent leur accès, seuls les nouveaux enrôlements utilisent
 * le nouveau code.
 */
async function lireCode(): Promise<string> {
  if (!process.stdin.isTTY) {
    let texte = '';
    for await (const morceau of process.stdin) texte += morceau;
    return texte.trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Saisie masquée : rien n'est renvoyé à l'écran pendant la frappe.
  const sortie = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  sortie._writeToOutput = (s: string) => { if (s.includes('Code')) sortie.output.write(s); };
  const code = await new Promise<string>((ok) => rl.question('Code de synchronisation ORION : ', ok));
  rl.close();
  process.stdout.write('\n');
  return code.trim();
}

const code = await lireCode();
if (code.length < 16) {
  console.error('Code trop court : 16 caractères au moins.');
  process.exit(1);
}
const empreinte = await empreinteCodeSynchro(code);
if (!(await verifierCodeSynchro(code, empreinte))) {
  console.error('Vérification de l’empreinte impossible.');
  process.exit(1);
}
console.log(`ORION_CODE_SYNCHRO_EMPREINTE=${empreinte}`);
