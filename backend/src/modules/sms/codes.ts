import type { FastifyBaseLogger } from 'fastify';
import { config } from '../../config/index.js';
import { AppError, badRequest } from '../../core/errors.js';
import type { OtpStore } from '../driver-app/auth.js';
import { messageCode, type SmsSender } from './index.js';

const masquer = (phone: string) => `${phone.slice(0, 6)}••••${phone.slice(-2)}`;

/**
 * Émet un code de connexion et l'envoie par SMS. Commun aux clients et aux chauffeurs.
 *
 * - Numéro hors des préfixes autorisés : refusé avant tout envoi (fraude aux SMS).
 * - Production sans opérateur : refus explicite (503) plutôt qu'un SMS qui n'arrive pas.
 * - Échec de l'opérateur : le code est annulé (le client peut réessayer tout de suite).
 * - Code imposé (compte de revue Apple / Google) : aucun SMS n'est envoyé.
 */
export async function emettreCode(o: {
  sms: SmsSender; otps: OtpStore; phone: string; pour: 'client' | 'chauffeur';
  log: FastifyBaseLogger; codeImpose?: string;
}): Promise<{ code: string; expiresAt: string; envoye: boolean }> {
  const { sms, otps, phone, pour, log, codeImpose } = o;
  const prefixes = config.SMS_ALLOWED_PREFIXES.split(',').map((p) => p.trim()).filter(Boolean);
  if (!codeImpose && sms.reel && prefixes.length && !prefixes.some((p) => phone.startsWith(p))) {
    throw badRequest('Ce numéro n’est pas pris en charge : utilisez un numéro de Côte d’Ivoire');
  }
  if (!codeImpose && !sms.reel && config.NODE_ENV === 'production') {
    log.error({ phone: masquer(phone) }, 'Code refusé : aucun opérateur SMS configuré (SMS_PROVIDER=console)');
    throw new AppError(503, 'SMS_INDISPONIBLE', 'L’envoi des codes par SMS n’est pas encore activé. Réessayez plus tard.');
  }
  const issued = otps.issue(phone, codeImpose);
  if ('retryInSeconds' in issued) {
    const attente = issued.plafond
      ? `Trop de codes demandés pour ce numéro : réessayez dans ${Math.ceil(issued.retryInSeconds / 60)} min`
      : `Code déjà envoyé : réessayez dans ${issued.retryInSeconds} s`;
    throw new AppError(429, 'RATE_LIMITED', attente);
  }
  if (codeImpose || !sms.reel) return { ...issued, envoye: false };

  const minutes = Math.round(config.DRIVER_OTP_TTL_SECONDS / 60);
  try {
    const r = await sms.envoyer(phone, messageCode(issued.code, minutes, pour));
    log.info({ phone: masquer(phone), fournisseur: sms.fournisseur, id: r.id }, 'SMS de code envoyé');
    return { ...issued, envoye: true };
  } catch (e) {
    otps.revoke(phone);
    log.error({ phone: masquer(phone), fournisseur: sms.fournisseur, err: (e as Error).message }, 'Échec d’envoi du SMS de code');
    throw new AppError(502, 'SMS_ECHEC', 'Le SMS n’a pas pu être envoyé. Vérifiez le numéro ou réessayez dans un instant.');
  }
}
