import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

/**
 * VOIX DU GUIDAGE (app chauffeur).
 *
 * Dans l'application Android, la WebView n'a pas de synthèse vocale (speechSynthesis
 * n'existe pas) : le guidage restait muet. La voix passe donc par le moteur vocal du
 * téléphone (Google Text-to-Speech, Samsung TTS…), comme Yango ou Waze. Dans un navigateur,
 * on garde la synthèse du navigateur.
 */
const natif = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TextToSpeech');

export function voixDisponible(): boolean {
  return natif() || (typeof window !== 'undefined' && 'speechSynthesis' in window);
}

/** Dit la phrase tout de suite (coupe la précédente). `langue` : fr-FR, en-US… */
export async function parler(phrase: string, langue: string): Promise<void> {
  if (natif()) {
    try {
      await TextToSpeech.stop().catch(() => undefined);
      await TextToSpeech.speak({ text: phrase, lang: langue, rate: 1.0, pitch: 1.0, volume: 1.0, category: 'playback' });
      return;
    } catch { /* moteur vocal absent ou langue non installée : on tente la voix du navigateur */ }
  }
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(phrase);
    u.lang = langue;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* pas de voix : le bandeau suffit */ }
}

export function taire(): void {
  if (natif()) void TextToSpeech.stop().catch(() => undefined);
  try { window.speechSynthesis?.cancel(); } catch { /* rien à couper */ }
}
