import { chargerSecretsGoogle } from './modules/gcp/secrets.js';

/**
 * Point d'entrée du serveur.
 *
 * Les secrets d'abord : toute variable d'environnement de la forme `sm://nom` est remplacée
 * par la valeur du secret correspondant dans Google Secret Manager. La configuration n'est
 * lue qu'ensuite (import différé), si bien qu'elle ne voit jamais une référence à la place
 * d'une clé. Sans référence `sm://`, Google n'est pas contacté et rien ne change.
 */
try {
  const charges = await chargerSecretsGoogle();
  // Les noms seulement : la valeur d'un secret n'est jamais écrite dans les journaux.
  // eslint-disable-next-line no-console
  if (charges.length) console.log(`Secret Manager : ${charges.length} secret(s) chargé(s) — ${charges.join(', ')}`);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('Démarrage refusé — secrets illisibles :', err instanceof Error ? err.message : err);
  process.exit(1);
}

const { main } = await import('./principal.js');
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Échec du démarrage', err);
  process.exit(1);
});
