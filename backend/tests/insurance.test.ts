import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePrice, INSURANCE_RATE } from '../src/modules/services/ride/pricing.js';
import { InsuranceService } from '../src/modules/insurance/service.js';
import { WalletService } from '../src/modules/wallet/service.js';
import { createRepository } from '../src/core/db/repository.js';
import type { InsuranceContribution } from '../src/modules/insurance/service.js';

const origin = { lat: 5.3236, lng: -4.0217 };
const destination = { lat: 5.3599, lng: -3.9876 };

test('assurance désactivée : pas de cotisation', () => {
  const r = estimatePrice({ origin, destination, category: 'bronze' });
  assert.equal(r.breakdown.insurance, 0);
});

test('assurance activée : cotisation = 2% du sous-total', () => {
  const r = estimatePrice({ origin, destination, category: 'bronze', insurance: true });
  assert.equal(r.breakdown.insurance, Math.round(r.breakdown.subtotal * INSURANCE_RATE));
  assert.ok(r.breakdown.insurance > 0);
});

test('cotisations + remboursement 50% crédité au portefeuille client', () => {
  const wallet = new WalletService(createRepository('client_wallet'));
  const ins = new InsuranceService(createRepository<InsuranceContribution>('insurance'), wallet);
  ins.addContribution('client-1', 'ride-1', 200);
  ins.addContribution('client-1', 'ride-2', 300);
  const sum = ins.summary('client-1');
  assert.equal(sum.total, 500);
  assert.equal(sum.estimatedRefund, 250);

  const { refunded } = ins.yearEndRefund('client-1');
  assert.equal(refunded, 250);
  assert.equal(wallet.balance('client-1'), 250);
  // Déjà remboursé : plus rien à rembourser.
  assert.equal(ins.yearEndRefund('client-1').refunded, 0);
});
