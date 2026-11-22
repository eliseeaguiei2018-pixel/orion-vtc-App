import type { FastifyBaseLogger } from 'fastify';
import { config } from '../../config/index.js';
import { AppError, badRequest } from '../../core/errors.js';
import type { OtpStore } from '../driver-app/auth.js';
import { messageCode, messageCodeWhatsApp, SmsError, type SmsSender, type WhatsAppSender } from './index.js';

const masquer = (phone: string) => `${phone.slice(0, 6)}••••${phone.slice(-2)}`;

/** Canal d'envoi du code de connexion choisi dans l'app. */
export type CanalCode = 'sms' | 'whatsapp';

/**
 * Refus de WhatsApp traduits pour le client (codes d'erreur Twilio) : il sait aussitôt quoi
 * faire, au lieu d'attendre un code qui n'arrivera pas.
 */
function messageEchecWhatsApp(e: unknown): string {
  const code = e instanceof SmsError ? e.codeOperateur : undefined;
  if (code === 63015) return 'Ce numéro n’a pas encore rejoint le WhatsApp de test d’ORION : envoyez d’abord le message d’inscription, ou recevez le code par SMS.';
  if (code === 63016) return 'WhatsApp n’accepte ce message qu’après un message de votre part : écrivez d’abord au numéro WhatsApp d’ORION, ou recevez le code par SMS.';
  if (code === 63003 || code === 63024 || code === 21211) return 'Ce numéro ne semble pas utiliser WhatsApp. Recevez le code par SMS.';
  return 'Le message WhatsApp n’a pas pu être envoyé. Réessayez dans un instant ou recevez le code par SMS.';
}

/**
 * Émet un code de connexion et l'envoie par SMS ou par WhatsApp. Commun aux clients et aux
 * chauffeurs.
 *
 * - Numéro hors des préfixes autorisés : refusé avant tout envoi (fraude aux SMS).
 * - Production sans opérateur pour le canal choisi : refus explicite (503) plutôt qu'un code
 *   qui n'arrive pas.
 * - Échec de l'opérateur : le code est annulé (le client peut réessayer tout de suite).
 * - Code imposé (compte de revue Apple / Google) : rien n'est envoyé.
 */
export async function emettreCode(o: {
  sms: SmsSender; whatsapp?: WhatsAppSender | null; canal?: CanalCode;
  otps: OtpStore; phone: string; pour: 'client' | 'chauffeur';
  log: FastifyBaseLogger; codeImpose?: string;
}): Promise<{ code: string; expiresAt: string; envoye: boolean }> {
  const { sms, otps, phone, pour, log, codeImpose } = o;
  const canal: CanalCode = o.canal ?? 'sms';
  const whatsapp = o.whatsapp ?? null;
  const reel = canal === 'whatsapp' ? whatsapp !== null : sms.reel;
  const prefixes = config.SMS_ALLOWED_PREFIXES.split(',').map((p) => p.trim()).filter(Boolean);
  if (!codeImpose && reel && prefixes.length && !prefixes.some((p) => phone.startsWith(p))) {
    throw badRequest('Ce numéro n’est pas pris en charge : utilisez un numéro de Côte d’Ivoire');
  }
  if (!codeImpose && !reel && config.NODE_ENV === 'production') {
    if (canal === 'whatsapp') {
      log.error({ phone: masquer(phone) }, 'Code refusé : WhatsApp non configuré (TWILIO_WHATSAPP_FROM)');
      throw new AppError(503, 'WHATSAPP_INDISPONIBLE', 'L’envoi des codes par WhatsApp n’est pas encore activé. Recevez le code par SMS.');
    }
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
  if (codeImpose || !reel) return { ...issued, envoye: false };

  const minutes = Math.round(config.DRIVER_OTP_TTL_SECONDS / 60);
  if (canal === 'whatsapp' && whatsapp) {
    try {
      const r = await whatsapp.envoyer(phone, issued.code, messageCodeWhatsApp(issued.code, minutes, pour));
      log.info({ phone: masquer(phone), fournisseur: 'twilio-whatsapp', id: r.id }, 'Code envoyé par WhatsApp');
      return { ...issued, envoye: true };
    } catch (e) {
      otps.revoke(phone);
      log.error({ phone: masquer(phone), fournisseur: 'twilio-whatsapp', err: (e as Error).message }, 'Échec d’envoi du code par WhatsApp');
      throw new AppError(502, 'WHATSAPP_ECHEC', messageEchecWhatsApp(e));
    }
  }
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
