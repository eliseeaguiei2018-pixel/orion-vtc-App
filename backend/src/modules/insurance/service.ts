import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';
import type { WalletService } from '../wallet/service.js';

/**
 * ORION Assurance (optionnelle).
 *
 * Le client peut activer l'assurance à la commande : il cotise 4 % du montant de la course
 * et est assisté par ORION en cas d'accident (frais médicaux pris en charge selon les
 * conditions). En fin d'année, les clients ayant cotisé sont **remboursés à 50%** de leurs
 * cotisations, crédité sur leur **portefeuille client** (transférable en mobile money ou
 * utilisable pour payer des courses).
 */
export const INSURANCE_REFUND_RATE = 0.5; // remboursement 50% en fin d'année

export interface InsuranceContribution {
  id: string;
  clientId: string;
  rideId: string;
  amount: number; // FCFA
  year: number;
  refunded: boolean;
  at: string;
}

export interface InsuranceSummary {
  count: number;
  total: number;
  year: number;
  estimatedRefund: number; // 50% des cotisations non remboursées de l'année
}

export class InsuranceService {
  constructor(
    private readonly repo: Repository<InsuranceContribution>,
    private readonly clientWallet: WalletService,
  ) {}

  /** Enregistre une cotisation d'assurance (au paiement d'une course assurée). */
  addContribution(clientId: string, rideId: string, amount: number): InsuranceContribution {
    const c: InsuranceContribution = {
      id: randomUUID(),
      clientId,
      rideId,
      amount,
      year: new Date().getFullYear(),
      refunded: false,
      at: new Date().toISOString(),
    };
    this.repo.put(c);
    return c;
  }

  private forClient(clientId: string): InsuranceContribution[] {
    return this.repo.all().filter((c) => c.clientId === clientId);
  }

  summary(clientId: string, year = new Date().getFullYear()): InsuranceSummary {
    const items = this.forClient(clientId).filter((c) => c.year === year);
    const total = items.reduce((s, c) => s + c.amount, 0);
    const refundable = items.filter((c) => !c.refunded).reduce((s, c) => s + c.amount, 0);
    return { count: items.length, total, year, estimatedRefund: Math.round(refundable * INSURANCE_REFUND_RATE) };
  }

  /** Remboursement de fin d'année : crédite 50% des cotisations non remboursées au wallet client. */
  yearEndRefund(clientId: string, year = new Date().getFullYear()): { refunded: number } {
    const items = this.forClient(clientId).filter((c) => c.year === year && !c.refunded);
    const total = items.reduce((s, c) => s + c.amount, 0);
    const refund = Math.round(total * INSURANCE_REFUND_RATE);
    if (refund > 0) {
      this.clientWallet.credit(clientId, refund, 'insurance_refund', `Remboursement ORION Assurance ${year} (50%)`);
      for (const c of items) {
        c.refunded = true;
        this.repo.put(c);
      }
    }
    return { refunded: refund };
  }
}
