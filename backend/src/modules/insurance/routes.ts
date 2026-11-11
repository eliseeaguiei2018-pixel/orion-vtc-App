import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { INSURANCE_RATE } from '../services/ride/pricing.js';
import { INSURANCE_REFUND_RATE } from './service.js';
import { exigerTitulaire } from '../clients/auth.js';
import { conflict } from '../../core/errors.js';

export async function insuranceRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Portefeuille et cotisations : données financières, réservées au titulaire connecté.
  const titulaire = (req: Parameters<typeof exigerTitulaire>[0], id: string) =>
    exigerTitulaire(req, id, (c) => Boolean(container.clients.get(c)));

  app.get('/insurance/info', async () => ({
    rate: INSURANCE_RATE,
    refundRate: INSURANCE_REFUND_RATE,
    description:
      "ORION Assurance (optionnelle) : 2% de la course. En cas d'accident, ORION vous assiste " +
      'et prend en charge les frais médicaux selon les conditions. 50% des cotisations sont ' +
      'remboursées en fin d\'année sur votre portefeuille.',
  }));

  // Résumé des cotisations d'un client + remboursement estimé.
  app.get('/clients/:id/insurance', async (req) => {
    const { id } = req.params as { id: string };
    titulaire(req, id);
    return { summary: container.insurance.summary(id) };
  });

  // Remboursement de fin d'année (50%) → portefeuille client.
  app.post('/clients/:id/insurance/refund', async (req) => {
    const { id } = req.params as { id: string };
    titulaire(req, id);
    // Remboursement de FIN D'ANNÉE : pas avant décembre (sinon on rembourserait 50 % de
    // cotisations pour des courses encore à venir dans l'année).
    if (new Date().getMonth() < 11) throw conflict('Le remboursement de 50 % est versé en fin d’année, à partir de décembre.');
    return container.insurance.yearEndRefund(id);
  });

  // Portefeuille client (solde + historique).
  app.get('/clients/:id/wallet', async (req) => {
    const { id } = req.params as { id: string };
    titulaire(req, id);
    return { balance: container.clientWallet.balance(id), currency: 'XOF', history: container.clientWallet.history(id) };
  });

  // Transfert du portefeuille vers mobile money (Wave, OM, MoMo, Moov).
  app.post('/clients/:id/wallet/transfer', async (req) => {
    const { id } = req.params as { id: string };
    titulaire(req, id);
    const body = parse(z.object({ amount: z.number().positive(), method: z.string() }), req.body);
    const entry = container.clientWallet.requestPayout(id, body.amount);
    return { transfer: entry, balance: container.clientWallet.balance(id) };
  });
}
