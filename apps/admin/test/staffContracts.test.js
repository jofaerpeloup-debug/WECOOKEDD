import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyStaffActionBody,
  registrationPayload,
  rejectionPayload,
  staffPaths,
  staffRequests,
} from '../src/staffContracts.js';

test('registration sends only name, email, and password', () => {
  assert.deepEqual(registrationPayload({
    name: '  Ada  ', email: ' ada@example.com ', password: 'secret-value', role: 'admin',
  }), { name: 'Ada', email: 'ada@example.com', password: 'secret-value' });
});

test('staff action contracts use exact endpoints and bodies', () => {
  assert.deepEqual(emptyStaffActionBody(), {});
  assert.deepEqual(rejectionPayload('  Needs more detail  '), { reason: 'Needs more detail' });
  assert.equal(staffPaths.approve('application id'), '/staff/moderator-applications/application%20id/approve');
  assert.equal(staffPaths.reject('a1'), '/staff/moderator-applications/a1/reject');
  assert.equal(staffPaths.demote('u1'), '/staff/moderators/u1/demote');
});

test('staff mutations use exact POST request contracts with no authority fields', () => {
  assert.deepEqual(staffRequests.apply(), {
    method: 'POST', path: '/staff/moderator-applications', body: {},
  });
  assert.deepEqual(staffRequests.approve('application id'), {
    method: 'POST', path: '/staff/moderator-applications/application%20id/approve', body: {},
  });
  assert.deepEqual(staffRequests.reject('a1', '  Not enough detail  '), {
    method: 'POST', path: '/staff/moderator-applications/a1/reject', body: { reason: 'Not enough detail' },
  });
  assert.deepEqual(staffRequests.demote('user id'), {
    method: 'POST', path: '/staff/moderators/user%20id/demote', body: {},
  });
});

test('Staff Portal password reset uses the public backend contract', () => {
  assert.deepEqual(staffRequests.forgotPassword('  Applicant@Example.COM  '), {
    method: 'POST',
    path: '/auth/forgot-password',
    auth: false,
    body: { email: 'applicant@example.com' },
  });
});
