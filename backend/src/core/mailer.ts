import { logger } from './logger.js';

/**
 * Envoi d'e-mail — stub de développement.
 * En production : brancher un fournisseur SMTP / API (SendGrid, Mailgun, SES…) derrière
 * cette même fonction. Ici on journalise et on renvoie un statut, sans dépendance.
 */
export async function sendEmail(to: string, subject: string, body: string): Promise<{ sent: boolean }> {
  logger.info({ to, subject }, 'E-mail (stub) envoyé');
  void body;
  return { sent: true };
}

/** Construit le résumé de course envoyé au client par e-mail. */
export function rideReceipt(amount: number, method: string, currency = 'XOF'): { subject: string; body: string } {
  return {
    subject: 'Votre reçu de course ORION',
    body: `Merci d'avoir voyagé avec ORION. Montant: ${amount} ${currency} payé via ${method}.`,
  };
}
