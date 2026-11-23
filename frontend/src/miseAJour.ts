import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { serveurActif } from './serveur';
import { signatureValide, type AppOrion, type ManifesteMaj } from './miseAJourSignature';

export type { AppOrion, ManifesteMaj } from './miseAJourSignature';

/**
 * MISES À JOUR ANNONCÉES (apps client, ORION Pro et console installées en APK).
 *
 * Tout passe par le serveur ORION, plus jamais par un fichier envoyé à la main :
 *  - une nouvelle VERSION DE L'APPLICATION (écrans, règles, textes) est un paquet web que l'app
 *    télécharge et installe elle-même, en quelques secondes ;
 *  - une nouvelle APK (changement du moteur natif : permission, module Android) est hébergée par
 *    le serveur ; l'app la télécharge par le navigateur du téléphone, Android propose « Mettre à
 *    jour » et garde les données (même clé de signature que l'app installée).
 * Dans les deux cas, à l'ouverture de l'app (jamais pendant une course ou une offre), un message
 * « Mise à jour disponible » propose de la télécharger. « Plus tard » la repropose à la prochaine
 * ouverture ; une version « obligatoire » ne peut pas être reportée.
 *
 * Sécurité :
 *  - le manifeste d'un paquet web est SIGNÉ par le serveur ORION ; l'application vérifie la
 *    signature avec la clé publique intégrée à l'APK avant de télécharger quoi que ce soit ;
 *  - le module natif vérifie ensuite l'empreinte SHA-256 du paquet : un fichier modifié
 *    n'est jamais installé ; si la nouvelle version ne démarre pas, retour à la précédente ;
 *  - une APK n'est installée par Android que si elle porte la signature de l'app en place.
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

/** Ce que l'app annonce à l'utilisateur. */
export interface AvisMaj {
  type: 'web' | 'apk';
  app: AppOrion;
  version: string;
  notes: string;
  /** Taille du téléchargement, en octets. */
  taille: number;
  obligatoire: boolean;
  /** Adresse du paquet ou de l'APK, sur le serveur ORION. */
  url: string;
  etat: 'propose' | 'telechargement' | 'installation' | 'erreur' | 'ouvert';
  /** Téléchargement en cours, en %. */
  progression: number;
}

let avis: (AvisMaj & { sha256?: string; paquetId?: string }) | null = null;
/** « Plus tard » : masqué jusqu'à la prochaine ouverture de l'app. */
let reporte = false;
let visible: AvisMaj | null = null;
const abonnes = new Set<() => void>();

function recalculer(): void {
  let libre = false;
  try { libre = reglage?.libre() ?? false; } catch { libre = false; }
  // Un téléchargement lancé reste visible jusqu'au bout, même si une course arrive.
  const enMarche = avis?.etat === 'telechargement' || avis?.etat === 'installation';
  // Une fois affiché, le message reste jusqu'au choix de l'utilisateur (pas de clignotement).
  const dejaAffiche = visible !== null && avis !== null && visible.version === avis.version && visible.type === avis.type;
  const suivant = avis && !reporte && (libre || enMarche || dejaAffiche) ? { ...avis } : null;
  const avant = visible;
  if (JSON.stringify(avant) === JSON.stringify(suivant)) return;
  visible = suivant;
  for (const f of abonnes) f();
}

function definir(maj: Partial<NonNullable<typeof avis>> | null): void {
  avis = maj === null ? null : ({ ...(avis ?? {}), ...maj } as NonNullable<typeof avis>);
  recalculer();
}

/** Pour l'écran « Mise à jour disponible » (useSyncExternalStore). */
export const avisMiseAJour = {
  abonner(f: () => void): () => void { abonnes.add(f); return () => { abonnes.delete(f); }; },
  lire(): AvisMaj | null { return visible; },
};

/** Démarre la surveillance des mises à jour (sans effet hors APK). */
export function demarrerMisesAJour(o: { app: AppOrion; libre: () => boolean }): void {
  if (!actif() || reglage) return;
  reglage = o;
  void App.addListener('resume', () => { reporte = false; recalculer(); void verifierMiseAJour(); });
  window.setInterval(() => void verifierMiseAJour(), 20 * 60_000);
  // L'app devient libre (fin de course, fin d'offre) : le message apparaît.
  window.setInterval(recalculer, 5_000);
  void verifierMiseAJour();
}

/** Avis du serveur en direct : une version vient d'être publiée. */
export function signalerNouvelleVersion(m?: { app?: string } | null): void {
  if (!reglage || (m?.app && m.app !== reglage.app)) return;
  void verifierMiseAJour();
}

interface VersionNative { app: string; versionCode: number; version: string; taille: number; notes: string; obligatoire: boolean; chemin: string }

/** Interroge le serveur : nouvelle APK d'abord, sinon nouvelle version de l'application. */
export async function verifierMiseAJour(): Promise<void> {
  if (!reglage || enCours || avis?.etat === 'telechargement' || avis?.etat === 'installation') return;
  enCours = true;
  try {
    const base = serveurActif();
    const app = reglage.app;
    const natif = Number((await App.getInfo()).build) || 0;
    const absolue = (chemin: string) => new URL(chemin, base || window.location.origin).toString();

    const rn = await fetch(`${base}/apps/${app}/version-native`, { cache: 'no-store' }).catch(() => null);
    if (rn?.ok) {
      const v = (await rn.json()) as VersionNative;
      if (v.app === app && v.versionCode > natif && typeof v.chemin === 'string' && v.chemin.startsWith(`/apps/${app}/apk/`)) {
        if (avis?.type !== 'apk' || avis.version !== v.version) {
          definir(null);
          definir({ type: 'apk', app, version: v.version, notes: v.notes ?? '', taille: v.taille, obligatoire: v.obligatoire === true, url: absolue(v.chemin), etat: 'propose', progression: 0 });
        }
        return;
      }
    }

    const r = await fetch(`${base}/apps/${app}/manifeste`, { cache: 'no-store' });
    if (!r.ok) return;
    const m = (await r.json()) as ManifesteMaj & { obligatoire?: boolean };
    if (m.app !== app || m.version === VERSION_WEB) { if (avis?.type === 'web') definir(null); return; }
    if (avis?.type === 'web' && avis.version === m.version) return;
    if (!(await signatureValide(m))) return;
    if (m.natifMin > natif) return;
    const connus = (await CapacitorUpdater.list()).bundles.filter((b) => b.version === m.version);
    // Une version qui a déjà échoué sur ce téléphone n'est pas reproposée (pas de boucle).
    if (connus.some((b) => b.status === 'error')) return;
    const deja = connus.find((b) => b.status === 'pending' || b.status === 'success');
    definir(null);
    definir({ type: 'web', app, version: m.version, notes: m.notes ?? '', taille: m.taille, obligatoire: m.obligatoire === true, url: absolue(m.chemin), sha256: m.sha256, paquetId: deja?.id, etat: 'propose', progression: 0 });
  } catch {
    /* hors ligne ou serveur sans mise à jour : nouvel essai plus tard */
  } finally {
    enCours = false;
  }
}

/** « Mettre à jour » : télécharge et installe (paquet web), ou ouvre le téléchargement de l'APK. */
export async function installerMiseAJour(): Promise<void> {
  const a = avis;
  if (!a || a.etat === 'telechargement' || a.etat === 'installation') return;
  if (a.type === 'apk') {
    // Hors du domaine de l'app : Capacitor confie l'adresse au navigateur du téléphone, qui
    // télécharge l'APK ; Android propose ensuite de l'installer par-dessus l'app actuelle.
    definir({ etat: 'ouvert' });
    window.location.assign(a.url);
    return;
  }
  definir({ etat: 'telechargement', progression: 0 });
  const suivi = await CapacitorUpdater.addListener('download', (e: { percent?: number }) => {
    if (typeof e?.percent === 'number') definir({ progression: Math.max(0, Math.min(100, Math.round(e.percent))) });
  }).catch(() => null);
  try {
    const id = a.paquetId ?? (await CapacitorUpdater.download({ url: a.url, version: a.version, checksum: a.sha256 })).id;
    definir({ etat: 'installation', progression: 100, paquetId: id });
    // Redémarre l'app sur la nouvelle version (retour automatique à l'ancienne si elle échoue).
    await CapacitorUpdater.set({ id });
  } catch {
    definir({ etat: 'erreur' });
  } finally {
    void suivi?.remove();
  }
}

/** « Plus tard » : reproposée à la prochaine ouverture (impossible si obligatoire). */
export function reporterMiseAJour(): void {
  if (!avis || avis.obligatoire) return;
  reporte = true;
  recalculer();
}
