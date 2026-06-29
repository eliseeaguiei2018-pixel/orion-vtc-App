import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WalletService, computeCommission } from '../src/modules/wallet/service.js';
import { AppError } from '../src/core/errors.js';

test('commission = taux × montant, net = montant − commission', () => {
  const c = computeCommission(10000, 0.2);
  assert.equal(c.commission, 2000);
  assert.equal(c.net, 8000);
});

test('créditer une course augmente le solde du gain net', () => {
  const w = new WalletService();
  const c = w.creditRide('drv1', 'ride1', 10000);
  assert.equal(w.balance('drv1'), c.net);
  assert.ok(c.commission > 0);
});

test('le retrait diminue le solde', () => {
  const w = new WalletService();
  w.creditRide('drv1', 'ride1', 10000);
  const net = w.balance('drv1');
  w.requestPayout('drv1', 2000);
  assert.equal(w.balance('drv1'), net - 2000);
});

test('retrait refusé si solde insuffisant', () => {
  const w = new WalletService();
  assert.throws(() => w.requestPayout('drv1', 5000), AppError);
});

test('historique journalise gain + commission', () => {
  const w = new WalletService();
  w.creditRide('drv1', 'ride1', 10000);
  const types = w.history('drv1').map((e) => e.type);
  assert.ok(types.includes('ride_earning'));
  assert.ok(types.includes('commission'));
});
