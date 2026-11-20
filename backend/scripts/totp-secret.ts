import { randomBytes } from 'node:crypto';
import { base32Encode, totp } from '../src/modules/admin/auth.js';

/**
 * Génère un secret TOTP (2FA) pour un compte de direction ORION.
 *
 *   npm run totp-secret -- <username>
 *
 * 1. Ajoutez le champ "totp" à l'entrée ADMIN_USERS du compte.
 * 2. Scannez l'URL otpauth:// (ou saisissez le secret) dans Google Authenticator,
 *    Microsoft Authenticator, 1Password, Aegis…
 * 3. À la connexion, la console demandera le code à 6 chiffres.
 */
const [, , username = 'ceo'] = process.argv;

const secret = base32Encode(randomBytes(20)); // 160 bits (recommandation RFC 4226)
const url = `otpauth://totp/ORION:${encodeURIComponent(username)}?secret=${secret}&issuer=ORION&digits=6&period=30`;

// eslint-disable-next-line no-console
console.log(`Secret TOTP (à mettre dans ADMIN_USERS → "totp") :\n\n  ${secret}\n`);
// eslint-disable-next-line no-console
console.log(`URL d'enrôlement (application d'authentification) :\n\n  ${url}\n`);
// eslint-disable-next-line no-console
console.log(`Code actuel (vérification) : ${totp(secret)}`);
