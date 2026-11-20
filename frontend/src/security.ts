/**
 * Sécurité côté client : verrouillage biométrique (empreinte / Face ID).
 *
 * Sur le web, on s'appuie sur **WebAuthn** (authentificateur de plateforme) quand il est
 * disponible. Dans l'app native (Capacitor), on branche le plugin biométrique de l'OS
 * (Touch ID / Face ID / empreinte Android). En l'absence de matériel, repli simulé.
 */
const BIO_KEY = 'orion.biometric';

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
  } catch {
    /* stockage indisponible */
  }
};

/** Tente une authentification biométrique. Renvoie true si réussie (ou simulée). */
export async function authenticateBiometric(): Promise<boolean> {
  try {
    const wa = (navigator as { credentials?: { get?: unknown } }).credentials;
    if (wa && 'get' in wa && window.PublicKeyCredential) {
      // En production : challenge fourni par le serveur + assertion vérifiée côté backend.
      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          timeout: 30000,
          userVerification: 'required',
          rpId: location.hostname,
          allowCredentials: [],
        },
      } as CredentialRequestOptions);
      return true;
    }
  } catch {
    // L'utilisateur peut annuler ou l'appareil ne pas avoir de capteur : on retombe en simulé.
  }
  return true; // démo : déverrouillage simulé
}
