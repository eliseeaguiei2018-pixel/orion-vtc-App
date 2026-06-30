import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { INSURANCE_RATE } from '../services/ride/pricing.js';
import { INSURANCE_REFUND_RATE } from './service.js';

export async function insuranceRoutes(app: FastifyInstance, container: Container): Promise<void> {
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
    return { summary: container.insurance.summary(id) };
  });

  // Remboursement de fin d'année (50%) → portefeuille client.
  app.post('/clients/:id/insurance/refund', async (req) => {
    const { id } = req.params as { id: string };
    return container.insurance.yearEndRefund(id);
  });

  // Portefeuille client (solde + historique).
  app.get('/clients/:id/wallet', async (req) => {
    const { id } = req.params as { id: string };
    return { balance: container.clientWallet.balance(id), currency: 'XOF', history: container.clientWallet.history(id) };
  });

  // Transfert du portefeuille vers mobile money (Wave, OM, MoMo, Moov).
  app.post('/clients/:id/wallet/transfer', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ amount: z.number().positive(), method: z.string() }), req.body);
    const entry = container.clientWallet.requestPayout(id, body.amount);
    return { transfer: entry, balance: container.clientWallet.balance(id) };
  });
}
