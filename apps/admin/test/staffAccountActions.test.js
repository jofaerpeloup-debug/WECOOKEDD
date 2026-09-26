import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completeStaffPasswordChange,
  updateStaffName,
} from '../src/staffAccountActions.js';

test('name update waits for REST mutation then refetches authoritative backend user', async () => {
  const calls = [];
  const user = await updateStaffName({
    requestUpdate: async (name) => { calls.push(['update', name]); },
    refreshUser: async () => {
      calls.push(['refresh']);
      return { name: 'Updated Name' };
    },
  }, 'Updated Name');

  assert.deepEqual(calls, [['update', 'Updated Name'], ['refresh']]);
  assert.deepEqual(user, { name: 'Updated Name' });
});

test('successful password change clears local auth before best-effort Firebase cleanup', async () => {
  const calls = [];
  await completeStaffPasswordChange({
    requestChange: async (currentPassword, newPassword) => {
      calls.push(['request', currentPassword, newPassword]);
    },
    clearSession: () => { calls.push(['clear']); },
    signOutFirebase: async () => {
      calls.push(['firebase']);
      throw new Error('mirror unavailable');
    },
  }, { currentPassword: 'legacy password', newPassword: 'ValidPass1!' });

  assert.deepEqual(calls, [
    ['request', 'legacy password', 'ValidPass1!'],
    ['clear'],
    ['firebase'],
  ]);
});

test('failed password change preserves the current local session', async () => {
  let cleared = false;
  await assert.rejects(
    completeStaffPasswordChange({
      requestChange: async () => { throw new Error('incorrect current password'); },
      clearSession: () => { cleared = true; },
      signOutFirebase: async () => {},
    }, { currentPassword: 'wrong', newPassword: 'ValidPass1!' }),
    /incorrect current password/,
  );
  assert.equal(cleared, false);
});
