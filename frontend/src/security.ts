/**
 * Sécurité côté client : liaison de l'empreinte digitale ou du visage du téléphone.
 *
 * Dans l'application installée (Capacitor), on passe par le capteur du téléphone : la
 * fenêtre système d'Android (BiometricPrompt) ou d'iOS (Touch ID / Face ID). ORION ne voit
 * jamais l'empreinte ni le visage : le téléphone répond seulement « reconnu » ou non.
 *
 * RIEN N'EST SIMULÉ. Dans un navigateur, la liaison est annoncée comme indisponible : avant,
 * l'interrupteur s'activait partout et le « déverrouillage » réussissait toujours, ce qui
 * laissait croire à une protection qui n'existait pas.
 */
import { Capacitor } from '@capacitor/core';
import { BiometryType, NativeBiometric } from '@capgo/capacitor-native-biometric';

const BIO_KEY = 'orion.biometric';
const DEPUIS_KEY = 'orion.biometric.depuis';

/** Ce que le téléphone propose : affichage seulement, jamais une décision de sécurité. */
export type CapteurBio = 'empreinte' | 'visage' | 'iris' | 'plusieurs';

export type EtatBio =
  | { dispo: true; capteur: CapteurBio; codeTelephone: boolean }
  | {
      dispo: false;
      /** web : pas dans l'app installée · sans_capteur · non_enregistre : rien d'enregistré
          dans les réglages du téléphone · bloque : trop d'essais · inconnu. */
      raison: 'web' | 'sans_capteur' | 'non_enregistre' | 'bloque' | 'inconnu';
      codeTelephone: boolean;
    };

export type MotifEchec = 'annule' | 'non_reconnu' | 'bloque' | 'non_enregistre' | 'indisponible' | 'erreur';
export type ResultatBio = { ok: true; a: number } | { ok: false; motif: MotifEchec; a: number };

/** Textes de la fenêtre système (dans la langue de l'application). */
export interface TextesBio { titre: string; sousTitre?: string; annuler: string }

export const estAppInstallee = (): boolean => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

export const isBiometricEnabled = (): boolean => {
  try {
    return localStorage.getItem(BIO_KEY) === '1';
  } catch {
    return false;
  }
};

export const setBiometricEnabled = (on: boolean): void => {
  try {
    localStorage.setItem(BIO_KEY, on ? '1' : '0');
    if (on) localStorage.setItem(DEPUIS_KEY, new Date().toISOString());
    else localStorage.removeItem(DEPUIS_KEY);
  } catch {
    /* stockage indisponible */
  }
};

/** Date de la liaison (ISO), ou null. */
export const biometrieLieeDepuis = (): string | null => {
  try { return isBiometricEnabled() ? localStorage.getItem(DEPUIS_KEY) : null; } catch { return null; }
};

const capteurDe = (type: BiometryType): CapteurBio => {
  switch (type) {
    case BiometryType.FACE_ID:
    case BiometryType.FACE_AUTHENTICATION: return 'visage';
    case BiometryType.IRIS_AUTHENTICATION: return 'iris';
    case BiometryType.MULTIPLE: return 'plusieurs';
    default: return 'empreinte';
  }
};

/** Codes d'erreur du module natif (BiometricAuthError) → motif lisible. */
const motifDe = (code: unknown): MotifEchec => {
  switch (Number(code)) {
    case 16: case 11: case 15: case 17: return 'annule';       // annulé par la personne ou le système
    case 10: return 'non_reconnu';                               // empreinte ou visage non reconnu
    case 2: case 4: return 'bloque';                             // trop d'essais
    case 3: case 14: return 'non_enregistre';                    // rien d'enregistré sur le téléphone
    case 1: return 'indisponible';                               // pas de capteur, ou capteur en panne
    default: return 'erreur';
  }
};

/** Ce que le téléphone sait faire, au moment où on le demande. */
export async function etatBiometrie(): Promise<EtatBio> {
  if (!estAppInstallee()) return { dispo: false, raison: 'web', codeTelephone: false };
  try {
    const r = await NativeBiometric.isAvailable({ useFallback: false });
    const codeTelephone = Boolean(r.deviceIsSecure);
    if (r.isAvailable) return { dispo: true, capteur: capteurDe(r.biometryType), codeTelephone };
    const m = motifDe(r.errorCode);
    return {
      dispo: false, codeTelephone,
      raison: m === 'non_enregistre' ? 'non_enregistre' : m === 'bloque' ? 'bloque' : m === 'indisponible' ? 'sans_capteur' : 'inconnu',
    };
  } catch {
    return { dispo: false, raison: 'inconnu', codeTelephone: false };
  }
}

/**
 * Ouvre la fenêtre système et attend l'empreinte ou le visage. Renvoie l'heure de la
 * réponse : l'écran de test l'affiche pour montrer que le capteur répond en direct.
 */
export async function verifierBiometrie(textes: TextesBio): Promise<ResultatBio> {
  if (!estAppInstallee()) return { ok: false, motif: 'indisponible', a: Date.now() };
  try {
    await NativeBiometric.verifyIdentity({
      title: textes.titre, subtitle: textes.sousTitre, reason: textes.sousTitre ?? textes.titre,
      negativeButtonText: textes.annuler, maxAttempts: 3,
    });
    return { ok: true, a: Date.now() };
  } catch (e) {
    return { ok: false, motif: motifDe((e as { code?: unknown } | null)?.code), a: Date.now() };
  }
}

/**
 * Secours du verrou : la fenêtre système propose aussi le code, le schéma ou le mot de
 * passe du téléphone (seule combinaison acceptée par toutes les versions d'Android). Sert quand le
 * capteur est bloqué après trop d'essais, ou que l'empreinte a été retirée des réglages —
 * sans cela, la personne resterait enfermée hors de son application.
 */
export async function verifierCodeTelephone(textes: TextesBio): Promise<ResultatBio> {
  if (!estAppInstallee()) return { ok: false, motif: 'indisponible', a: Date.now() };
  try {
    await NativeBiometric.verifyIdentity({
      title: textes.titre, subtitle: textes.sousTitre, reason: textes.sousTitre ?? textes.titre,
      allowedBiometryTypes: [BiometryType.MULTIPLE, BiometryType.DEVICE_CREDENTIAL],
    });
    return { ok: true, a: Date.now() };
  } catch (e) {
    return { ok: false, motif: motifDe((e as { code?: unknown } | null)?.code), a: Date.now() };
  }
}
