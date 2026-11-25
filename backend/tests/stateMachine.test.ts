import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rideStateMachine } from '../src/modules/services/ride/stateMachine.js';
import { AppError } from '../src/core/errors.js';

test('transition valide autorisée', () => {
  assert.ok(rideStateMachine.canTransition('searching', 'accepted'));
  assert.ok(rideStateMachine.canTransition('in_progress', 'completed'));
});

test('transition invalide refusée', () => {
  assert.equal(rideStateMachine.canTransition('completed', 'searching'), false);
  assert.throws(() => rideStateMachine.assertTransition('rated', 'in_progress'), AppError);
});

test('états terminaux détectés', () => {
  assert.ok(rideStateMachine.isTerminal('rated'));
  assert.ok(rideStateMachine.isTerminal('cancelled'));
  assert.equal(rideStateMachine.isTerminal('searching'), false);
});
