import { AccesGoogle, type OptionsAcces } from './acces.js';

/**
 * SECRET MANAGER — les secrets du serveur ne sont plus écrits dans ses variables d'environnement.
 *
 * Une variable dont la valeur commence par `sm://` désigne un secret de Google Secret Manager :
 *
 *     CLIENT_JWT_SECRET=sm://orion-client-jwt             dernière version, projet courant
 *     ADMIN_JWT_SECRET=sm://orion-admin-jwt#3             version 3
 *     MEDICAL_DATA_KEY=sm://projects/mon-projet/secrets/orion-medical/versions/latest
 *
 * Au démarrage, AVANT la lecture de la configuration, chaque référence est remplacée par la
 * valeur du secret. Le fichier d'environnement, l'historique de déploiement et la console de
 * l'hébergeur ne contiennent alors que des noms de secrets ; l'accès à leur valeur est accordé
 * au seul compte de service du serveur et chaque lecture est journalisée par Google.
 *
 * Un secret introuvable ou refusé arrête le démarrage : le serveur ne tourne jamais avec une
 * référence `sm://…` à la place d'une clé. Les valeurs ne sont ni journalisées ni renvoyées.
 */
export const PREFIXE_SECRET = 'sm://';

export interface ReferenceSecret { variable: string; projet?: string; secret: string; version: string }

/** Lit les références `sm://` de l'environnement. Une référence mal écrite est une erreur de configuration. */
export function referencesSecrets(env: Record<string, string | undefined>): ReferenceSecret[] {
  const refs: ReferenceSecret[] = [];
  for (const [variable, valeur] of Object.entries(env)) {
    if (!valeur?.startsWith(PREFIXE_SECRET)) continue;
    const chemin = valeur.slice(PREFIXE_SECRET.length).trim();
    const complet = /^projects\/([a-z0-9][a-z0-9-]{4,28}[a-z0-9])\/secrets\/([A-Za-z0-9_-]{1,255})(?:\/versions\/([A-Za-z0-9_-]+))?$/.exec(chemin);
    const court = /^([A-Za-z0-9_-]{1,255})(?:#([A-Za-z0-9_-]+))?$/.exec(chemin);
    if (complet) refs.push({ variable, projet: complet[1], secret: complet[2]!, version: complet[3] ?? 'latest' });
    else if (court) refs.push({ variable, secret: court[1]!, version: court[2] ?? 'latest' });
    else throw new Error(`${variable} : référence de secret invalide (attendu sm://nom, sm://nom#version ou sm://projects/…/secrets/…/versions/…)`);
  }
  return refs;
}

/** Lit la valeur d'un secret (API Secret Manager, méthode `versions.access`). */
export async function lireSecret(acces: AccesGoogle, ref: Omit<ReferenceSecret, 'variable'>): Promise<string> {
  const projet = ref.projet ?? await acces.projet();
  const r = await acces.appel<{ payload?: { data?: string } }>(
    'Secret Manager',
    `https://secretmanager.googleapis.com/v1/projects/${projet}/secrets/${ref.secret}/versions/${ref.version}:access`,
  );
  if (!r.payload?.data) throw new Error(`Secret ${ref.secret} : version sans contenu`);
  return Buffer.from(r.payload.data, 'base64').toString('utf8');
}

/**
 * Remplace dans `env` chaque référence `sm://` par la valeur du secret.
 * Renvoie le nom des variables chargées (jamais leur valeur). Sans référence : ne contacte pas Google.
 */
export async function chargerSecretsGoogle(env: Record<string, string | undefined> = process.env, options: OptionsAcces = {}): Promise<string[]> {
  const refs = referencesSecrets(env);
  if (refs.length === 0) return [];
  const acces = new AccesGoogle({ env, ...options });
  const valeurs = await Promise.all(refs.map(async (ref) => {
    try {
      // Un retour à la ligne final (fichier collé tel quel dans la console) ne fait pas partie du secret.
      return (await lireSecret(acces, ref)).replace(/\r?\n$/, '');
    } catch (e) {
      throw new Error(`${ref.variable} : secret « ${ref.secret} » illisible — ${e instanceof Error ? e.message : 'erreur inconnue'}`);
    }
  }));
  refs.forEach((ref, i) => { env[ref.variable] = valeurs[i]; });
  return refs.map((r) => r.variable);
}
