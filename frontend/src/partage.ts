import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import type { LatLng } from './types';

export type IssuePartage = 'partage' | 'copie' | 'annule' | 'echec';

/** Lien de carte public vers une position (s'ouvre sur n'importe quel téléphone, sans compte). */
export function lienPosition(p: LatLng): string {
  const lat = p.lat.toFixed(5);
  const lng = p.lng.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/**
 * Partage réel : la feuille de partage du téléphone (WhatsApp, SMS, e-mail…) dans l'app
 * Android/iOS, celle du navigateur sur le web, sinon le texte est copié. Avant, le bouton
 * « Partager » affichait seulement « Lien partagé » sans rien envoyer.
 */
export async function partager(titre: string, texte: string, lien: string): Promise<IssuePartage> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title: titre, text: texte, url: lien, dialogTitle: titre });
      return 'partage';
    }
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: titre, text: texte, url: lien });
      return 'partage';
    }
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'AbortError' || /cancel|annul/i.test(err?.message ?? '')) return 'annule';
  }
  try {
    await navigator.clipboard.writeText(`${texte}\n${lien}`);
    return 'copie';
  } catch {
    // Dernier recours : WhatsApp, l'appli de messagerie la plus utilisée à Abidjan.
    try { window.open(`https://wa.me/?text=${encodeURIComponent(`${texte}\n${lien}`)}`, '_blank'); return 'partage'; } catch { return 'echec'; }
  }
}
