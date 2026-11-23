import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { serveurActif } from './serveur';
import { signatureValide, type AppOrion, type ManifesteMaj } from './miseAJourSignature';

export type { AppOrion, ManifesteMaj } from './miseAJourSignature';

/**
 * MISES À JOUR À CHAUD (apps client, chauffeur et console installées en APK).
 *
 * Quand la direction publie une nouvelle version sur le serveur ORION, l'application la
 * télécharge d'elle-même et l'installe AU BON MOMENT, sans passer par une nouvelle APK :
 *  - jamais pendant une course (client) ni pendant une offre ou une course (chauffeur) ;
 *  - au retour dans l'application, ou après deux minutes sans toucher l'écran.
 *
 * Sécurité :
 *  - le manifeste de la version est SIGNÉ par le serveur ORION ; l'application vérifie la
 *    signature avec la clé publique ci-dessous avant de télécharger quoi que ce soit ;
 *  - le module natif vérifie ensuite l'empreinte SHA-256 du paquet : un fichier modifié
 *    n'est jamais installé ;
 *  - si la nouvelle version ne démarre pas, le téléphone revient seul à la précédente.
 *
 * Seuls les changements du moteur natif (nouvelle permission, nouveau module Android)
 * demandent encore une APK : le serveur l'indique (natifMin) et l'app ignore la version.
 */
declare const __VERSION_WEB__: string;
/** Version de l'application web en cours (fixée à la construction). */
export const VERSION_WEB: string = typeof __VERSION_WEB__ === 'string' ? __VERSION_WEB__ : 'dev';

const natifDispo = (): boolean => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('CapacitorUpdater');
/** Seules les APK officielles (construites avec VITE_MISES_A_JOUR=1) se mettent à jour à chaud. */
const actif = (): boolean => import.meta.env.VITE_MISES_A_JOUR === '1' && natifDispo();

/**
 * À appeler dès le démarrage, avant toute requête : confirme au téléphone que cette version
 * s'est bien lancée (sinon, au prochain lancement, il revient à la version précédente).
 */
export function confirmerDemarrage(): void {
  if (natifDispo()) void CapacitorUpdater.notifyAppReady().catch(() => undefined);
}

let reglage: { app: AppOrion; libre: () => boolean } | null = null;
let enCours = false;
let prete: { id: string; version: string } | null = null;
/** Ouverture ou retour dans l'app, et dernier geste de l'utilisateur. */
let ouverteA = Date.now();
let dernierGeste = 0;
const INACTIVITE_MS = 120_000;
const FENETRE_OUVERTURE_MS = 30_000;

/** Démarre la surveillance des mises à jour (sans effet hors APK). */
export function demarrerMisesAJour(o: { app: AppOrion; libre: () => boolean }): void {
  if (!actif() || reglage) return;
  reglage = o;
  const geste = () => { dernierGeste = Date.now(); };
  window.addEventListener('pointerdown', geste, { passive: true });
  window.addEventListener('keydown', geste, { passive: true });
  void App.addListener('resume', () => { ouverteA = Date.now(); dernierGeste = 0; appliquerSiLibre(); void verifierMiseAJour(); });
  window.setInterval(() => void verifierMiseAJour(), 20 * 60_000);
  window.setInterval(appliquerSiLibre, 15_000);
  void verifierMiseAJour();
}

/** Avis du serveur en direct : une version vient d'être publiée. */
export function signalerNouvelleVersion(avis?: { app?: string } | null): void {
  if (!reglage || (avis?.app && avis.app !== reglage.app)) return;
  void verifierMiseAJour();
}

/** Interroge le serveur, vérifie et télécharge la nouvelle version s'il y en a une. */
export async function verifierMiseAJour(): Promise<void> {
  if (!reglage || enCours) return;
  enCours = true;
  try {
    const base = serveurActif();
    const r = await fetch(`${base}/apps/${reglage.app}/manifeste`, { cache: 'no-store' });
    if (!r.ok) return;
    const m = (await r.json()) as ManifesteMaj;
    if (m.app !== reglage.app || m.version === VERSION_WEB || m.version === prete?.version) return;
    if (!(await signatureValide(m))) return;
    const natif = Number((await App.getInfo()).build) || 0;
    if (m.natifMin > natif) return;
    const connus = (await CapacitorUpdater.list()).bundles.filter((b) => b.version === m.version);
    // Une version qui a déjà échoué sur ce téléphone n'est pas réessayée (pas de boucle).
    if (connus.some((b) => b.status === 'error')) return;
    const deja = connus.find((b) => b.status === 'pending' || b.status === 'success');
    const paquet = deja ?? await CapacitorUpdater.download({ url: new URL(m.chemin, base || window.location.origin).toString(), version: m.version, checksum: m.sha256 });
    prete = { id: paquet.id, version: m.version };
    appliquerSiLibre();
  } catch {
    /* hors ligne ou serveur sans mise à jour : nouvel essai plus tard */
  } finally {
    enCours = false;
  }
}

/** Installe la version prête si l'app est libre : juste ouverte, ou laissée sans geste. */
function appliquerSiLibre(): void {
  if (!prete || !reglage) return;
  let libre = false;
  try { libre = reglage.libre(); } catch { libre = false; }
  const maintenant = Date.now();
  const justeOuverte = maintenant - ouverteA < FENETRE_OUVERTURE_MS && dernierGeste < ouverteA;
  const inactive = maintenant - Math.max(dernierGeste, ouverteA) > INACTIVITE_MS;
  if (!libre || !(justeOuverte || inactive)) return;
  const { id } = prete;
  prete = null;
  void CapacitorUpdater.set({ id }).catch(() => undefined);
}
