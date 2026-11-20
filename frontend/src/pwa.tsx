import { useEffect, useState } from 'react';
import { IconDownload } from './icons';

/**
 * APPLICATION WEB INSTALLABLE : la console, le tableau de bord et l'application chauffeur
 * s'installent depuis le navigateur, sans passer par une boutique.
 *
 * - Windows et macOS (Edge, Chrome) : « Installer » ouvre l'application dans sa propre
 *   fenêtre, avec son icône dans la barre des tâches ou le Dock.
 * - Android et HarmonyOS : « Installer » l'ajoute à l'écran d'accueil.
 * - iPhone et iPad (Safari) : Partager, puis « Sur l'écran d'accueil ».
 *
 * C'est aussi l'accès de secours : si une application installée pose problème, la même
 * adresse s'ouvre dans n'importe quel navigateur, avec les mêmes données.
 */

/** Application déjà emballée (bureau ou boutique) : le service worker n'y a pas sa place. */
function estEmballee(): boolean {
  const w = window as unknown as { orionBureau?: unknown; Capacitor?: { isNativePlatform?: () => boolean } };
  return Boolean(w.orionBureau) || Boolean(w.Capacitor?.isNativePlatform?.()) || !/^https?:$/.test(location.protocol);
}

/** Enregistre le service worker (version publiée seulement : en développement il gênerait). */
export function enregistrerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || estEmballee()) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* navigation privée, stockage refusé : l'application marche sans */ });
  });
}

interface InviteInstallation extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/** L'application tourne-t-elle déjà dans sa propre fenêtre ? */
export function estInstallee(): boolean {
  return window.matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/**
 * Bouton « Installer l'application ». N'apparaît que lorsque l'installation est possible
 * (navigateur compatible, pas déjà installée, pas déjà une application de bureau).
 */
export function BoutonInstaller({ classe, nom }: { classe: string; nom: string }) {
  const [invite, setInvite] = useState<InviteInstallation | null>(null);
  const [aideIos, setAideIos] = useState(false);
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const surInvite = (e: Event) => { e.preventDefault(); setInvite(e as InviteInstallation); };
    const surInstallee = () => setInvite(null);
    window.addEventListener('beforeinstallprompt', surInvite);
    window.addEventListener('appinstalled', surInstallee);
    return () => { window.removeEventListener('beforeinstallprompt', surInvite); window.removeEventListener('appinstalled', surInstallee); };
  }, []);

  if (estEmballee() || estInstallee()) return null;
  if (invite) {
    return (
      <button type="button" className={classe} data-testid="installer-application"
        onClick={() => { void invite.prompt().then(() => invite.userChoice).then(() => setInvite(null)); }}>
        <IconDownload size={16} /> Installer {nom} sur cet appareil
      </button>
    );
  }
  // Safari sur iPhone et iPad n'a pas d'invite : on explique le geste.
  if (ios) {
    return (
      <>
        <button type="button" className={classe} onClick={() => setAideIos((v) => !v)}><IconDownload size={16} /> Installer {nom} sur cet appareil</button>
        {aideIos && <p style={{ fontSize: 12.5, lineHeight: 1.5, margin: '8px 0 0', opacity: 0.85 }}>Dans Safari, touchez <strong>Partager</strong> puis <strong>Sur l’écran d’accueil</strong>.</p>}
      </>
    );
  }
  return null;
}
