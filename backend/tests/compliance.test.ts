import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPLIANCE_RULES, evaluateCompliance } from '../src/modules/compliance/rules.js';

const fullDriver = COMPLIANCE_RULES.FR!.requiredDriverDocs.map((type) => ({ type }));
const fullVehicle = COMPLIANCE_RULES.FR!.requiredVehicleDocs.map((type) => ({ type }));

test('dossier complet → éligible', () => {
  const r = evaluateCompliance('FR', fullDriver, fullVehicle);
  assert.equal(r.eligible, true);
  assert.equal(r.missingDriverDocs.length, 0);
  assert.equal(r.missingVehicleDocs.length, 0);
});

test('document manquant → non éligible avec liste', () => {
  const r = evaluateCompliance('FR', fullDriver.slice(1), fullVehicle);
  assert.equal(r.eligible, false);
  assert.ok(r.missingDriverDocs.length > 0);
});

test('document expiré → non éligible', () => {
  const expired = [...fullDriver];
  expired[0] = { type: expired[0]!.type, expiresAt: '2000-01-01' } as { type: string; expiresAt: string };
  const r = evaluateCompliance('FR', expired, fullVehicle);
  assert.equal(r.eligible, false);
  assert.ok(r.expiredDocs.length > 0);
});

test('juridiction inconnue → repli sur défaut', () => {
  const r = evaluateCompliance('XX', fullDriver, fullVehicle);
  assert.equal(r.eligible, true);
});
