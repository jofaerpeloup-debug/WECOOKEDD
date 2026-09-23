import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backendStaffIdentity,
  emptyStaffActionBody,
  hasStaffAuthErrors,
  loginPayload,
  passwordRequirementState,
  registrationPayload,
  rejectionPayload,
  resetTokenFromHash,
  STAFF_AUTH_ERROR_MESSAGES,
  staffPaths,
  staffRequests,
  validateStaffEmail,
  validateCurrentPassword,
  validateStaffLogin,
  validateStaffName,
  validateStaffRegistration,
} from '../src/staffContracts.js';
import {
  NEW_PASSWORD_ERROR_MESSAGES,
  PASSWORD_MAX_UTF8_BYTES,
  utf8ByteLength,
  validateNewPassword,
} from '@wecooked/contracts';

test('registration sends only name, email, and password', () => {
  assert.deepEqual(registrationPayload({
    name: '  Ada  ', email: ' ada@example.com ', password: 'secret-value', role: 'admin',
  }), { name: 'Ada', email: 'ada@example.com', password: 'secret-value' });
});

test('registration and login payloads normalize email without mutating password', () => {
  const password = '  Legacy+Password  ';
  assert.deepEqual(registrationPayload({
    name: '  Ada  ', email: ' ADA@Example.ORG ', password,
  }), { name: 'Ada', email: 'ADA@Example.ORG', password });
  assert.deepEqual(loginPayload({ email: ' ADA@Example.ORG ', password }), {
    email: 'ADA@Example.ORG',
    password,
  });
});

test('registration uses the complete shared new-password contract', () => {
  const accepted = [
    'ValidPass1!',
    'Äbcdefg1!',
    'AdaSecure1!',
    'ApplicantMail1!',
    `Aa1!${'b'.repeat(68)}`,
  ];
  for (const password of accepted) {
    assert.deepEqual(
      validateStaffRegistration({ name: 'Ada', email: 'applicant@mail.org', password }).password,
      [],
      `Expected shared-contract password to pass: ${password}`,
    );
  }
  assert.equal(utf8ByteLength(accepted.at(-1)), PASSWORD_MAX_UTF8_BYTES);

  const rejected = [
    ['lowercase1!', NEW_PASSWORD_ERROR_MESSAGES.UPPERCASE],
    ['UPPERCASE1!', NEW_PASSWORD_ERROR_MESSAGES.LOWERCASE],
    ['NoNumber!', NEW_PASSWORD_ERROR_MESSAGES.DIGIT],
    ['NoSpecial1', NEW_PASSWORD_ERROR_MESSAGES.SPECIAL],
    ['Has Space1!', NEW_PASSWORD_ERROR_MESSAGES.UNSUPPORTED],
    ['HasEmoji1!😀', NEW_PASSWORD_ERROR_MESSAGES.UNSUPPORTED],
    ['CaretPass1^', NEW_PASSWORD_ERROR_MESSAGES.SPECIAL],
    ['PlusPass1+', NEW_PASSWORD_ERROR_MESSAGES.SPECIAL],
    [`Aa1!${'b'.repeat(69)}`, NEW_PASSWORD_ERROR_MESSAGES.MAX_BYTES],
  ];
  for (const [password, expectedMessage] of rejected) {
    const errors = validateStaffRegistration({ name: 'Ada', email: 'ada@example.com', password }).password;
    assert.ok(errors.includes(expectedMessage), `Expected ${expectedMessage} for ${password}`);
    assert.deepEqual(errors, validateNewPassword(password));
  }
});

test('Staff email validation trims for validation and accepts common non-com domains', () => {
  for (const email of [
    'person@example.com',
    'person@example.edu',
    'person@example.org',
    'person@example.com.ph',
    '  person@example.edu  ',
  ]) {
    assert.deepEqual(validateStaffEmail(email), [], `Expected ${email} to pass`);
  }
  assert.deepEqual(validateStaffEmail('person.example.org'), [STAFF_AUTH_ERROR_MESSAGES.EMAIL_INVALID]);
  assert.deepEqual(
    validateStaffEmail(`${'a'.repeat(243)}@example.com`),
    [STAFF_AUTH_ERROR_MESSAGES.EMAIL_MAX_CHARS],
  );
});

test('login remains legacy-compatible and enforces only nonempty and 72 UTF-8 bytes', () => {
  for (const password of ['abcdefgh', 'legacy password', 'old+password', '^^^^^^^']) {
    assert.deepEqual(validateStaffLogin({ email: 'staff@example.com', password }).password, []);
  }
  assert.deepEqual(
    validateStaffLogin({ email: 'staff@example.com', password: '' }).password,
    [STAFF_AUTH_ERROR_MESSAGES.PASSWORD_REQUIRED],
  );
  assert.deepEqual(
    validateStaffLogin({ email: 'staff@example.com', password: 'a'.repeat(73) }).password,
    [STAFF_AUTH_ERROR_MESSAGES.PASSWORD_MAX_BYTES],
  );
});

test('password checklist state is derived from shared validator messages', () => {
  const valid = passwordRequirementState('ValidPass1!');
  assert.equal(valid.meetsRequirements, true);
  assert.ok(valid.requirements.every(({ met }) => met));

  const invalid = passwordRequirementState('ValidPass1!^');
  assert.equal(invalid.meetsRequirements, false);
  assert.equal(
    invalid.requirements.find(({ message }) => message === NEW_PASSWORD_ERROR_MESSAGES.UNSUPPORTED)?.met,
    false,
  );
  assert.deepEqual(invalid.errors, validateNewPassword('ValidPass1!^'));
  assert.equal(hasStaffAuthErrors({ name: [], email: [], password: [] }), false);
  assert.equal(hasStaffAuthErrors({ password: invalid.errors }), true);
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

test('Staff account REST mutations use the exact backend contracts', () => {
  assert.deepEqual(staffRequests.updateName('  Ada Lovelace  '), {
    method: 'PATCH',
    path: '/users/me',
    body: { name: 'Ada Lovelace' },
  });
  assert.deepEqual(staffRequests.changePassword('legacy password', 'ValidPass1!'), {
    method: 'POST',
    path: '/auth/change-password',
    body: { currentPassword: 'legacy password', newPassword: 'ValidPass1!' },
  });
  assert.deepEqual(staffRequests.resetPassword('reset-token', 'ValidPass1!'), {
    method: 'POST',
    path: '/auth/reset-password',
    auth: false,
    body: { token: 'reset-token', newPassword: 'ValidPass1!' },
  });
});

test('Staff name and current-password validation match backend boundary rules', () => {
  assert.deepEqual(validateStaffName('  Ada  '), []);
  assert.deepEqual(validateStaffName('   '), [STAFF_AUTH_ERROR_MESSAGES.NAME_REQUIRED]);
  assert.deepEqual(validateStaffName(` ${'a'.repeat(101)} `), [STAFF_AUTH_ERROR_MESSAGES.NAME_MAX_CHARS]);

  assert.deepEqual(validateCurrentPassword('legacy password'), []);
  assert.deepEqual(validateCurrentPassword(''), [STAFF_AUTH_ERROR_MESSAGES.PASSWORD_REQUIRED]);
  assert.deepEqual(
    validateCurrentPassword('a'.repeat(73)),
    [STAFF_AUTH_ERROR_MESSAGES.PASSWORD_MAX_BYTES],
  );
});

test('display identity is projected only from the backend user', () => {
  assert.deepEqual(backendStaffIdentity({
    name: 'Mongo Name',
    email: 'mongo@example.com',
    emailVerified: true,
    role: 'admin',
  }), {
    name: 'Mongo Name',
    email: 'mongo@example.com',
    emailVerified: true,
  });
  assert.equal(backendStaffIdentity(null), null);
});

test('backend reset tokens are read only from the URL fragment', () => {
  assert.equal(resetTokenFromHash('#token=abc_def-123'), 'abc_def-123');
  assert.equal(resetTokenFromHash('#other=value&token=encoded%2Dtoken'), 'encoded-token');
  assert.equal(resetTokenFromHash('?token=query-token'), null);
  assert.equal(resetTokenFromHash('#oobCode=firebase-code'), null);
  assert.equal(resetTokenFromHash(''), null);
});
