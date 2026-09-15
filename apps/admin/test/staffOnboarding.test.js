import test from 'node:test';
import assert from 'node:assert/strict';
import { registerModeratorApplicant, retryModeratorApplication } from '../src/staffOnboarding.js';

test('application failure preserves the registered account and does not register twice', async () => {
  let registrations = 0;
  let refreshes = 0;
  const failure = new Error('application unavailable');
  const result = await registerModeratorApplicant({
    register: async () => { registrations += 1; return { id: 'user-1' }; },
    apply: async () => { throw failure; },
    refresh: async () => { refreshes += 1; },
  }, { name: 'Ada', email: 'ada@example.com', password: 'secret' });

  assert.equal(registrations, 1);
  assert.equal(refreshes, 0);
  assert.equal(result.user.id, 'user-1');
  assert.equal(result.applicationSubmitted, false);
  assert.equal(result.applicationError, failure);
});

test('retry submits with the current session and never invokes registration', async () => {
  const calls = [];
  const state = await retryModeratorApplication({
    apply: async () => calls.push('apply'),
    refresh: async () => { calls.push('refresh'); return { mode: 'pending' }; },
  });
  assert.deepEqual(calls, ['apply', 'refresh']);
  assert.deepEqual(state, { mode: 'pending' });
});
