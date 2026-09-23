import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root: adminRoot,
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
  ssr: { external: ['@wecooked/contracts'] },
});

let screenModule;
let appModule;
try {
  screenModule = await server.ssrLoadModule('/src/StaffPortalScreens.jsx');
  appModule = await server.ssrLoadModule('/src/App.jsx');
} catch (error) {
  await server.close();
  throw error;
}
const {
  ConsumerScreen,
  PasswordRequirements,
  PendingState,
  RejectedState,
  StaffBootstrapError,
  StaffPortalAuthScreen,
  VerifyEmailState,
} = screenModule;
const { ResetPasswordScreen } = appModule;

const noop = async () => {};

test.after(async () => {
  await server.close();
});

test('password requirements component reflects every shared-validator requirement', () => {
  const invalidMarkup = renderToStaticMarkup(
    React.createElement(PasswordRequirements, { password: 'Password1^' }),
  );

  for (const label of [
    'At least 8 characters',
    'One uppercase letter',
    'One lowercase letter',
    'One number',
    'One of ! @ # $ % &amp; * ? _ - .',
    'No unsupported characters',
    '72 UTF-8 bytes or fewer',
  ]) {
    assert.ok(invalidMarkup.includes(label), `Expected checklist label: ${label}`);
  }
  assert.ok(!invalidMarkup.includes('Meets password requirements'));
  assert.ok(!invalidMarkup.includes('Strong password'));

  const validMarkup = renderToStaticMarkup(
    React.createElement(PasswordRequirements, { password: 'ValidPass1!' }),
  );
  assert.ok(validMarkup.includes('Meets password requirements'));

  const changedBackToInvalid = renderToStaticMarkup(
    React.createElement(PasswordRequirements, { password: 'ValidPass1! ' }),
  );
  assert.ok(!changedBackToInvalid.includes('Meets password requirements'));
  assert.ok(changedBackToInvalid.includes('Not met: No unsupported characters'));
});

test('login renders the editorial sign-in state and preserves every auth entry point', () => {
  const markup = renderToStaticMarkup(React.createElement(StaffPortalAuthScreen, {
    onSignIn: async () => {},
    onRegisterAndApply: async () => {},
    onForgotPassword: async () => {},
  }));

  assert.ok(markup.includes('for="staff-auth-email"'));
  assert.ok(markup.includes('type="email"'));
  assert.ok(markup.includes('autoComplete="username"'));
  assert.ok(markup.includes('autoComplete="current-password"'));
  assert.ok(markup.includes('KEEP EVERY'));
  assert.ok(markup.includes('COOKABLE.'));
  assert.ok(markup.includes('Manage recipe quality, ingredients, moderation, and catalog reliability'));
  assert.ok(markup.includes('Staff Portal'));
  assert.ok(markup.includes('Show password'));
  assert.ok(markup.includes('aria-pressed="false"'));
  assert.ok(markup.includes('Forgot password?'));
  assert.ok(markup.includes('Sign In'));
  assert.ok(markup.includes('Apply as Moderator'));
  assert.ok(markup.includes('fetchpriority="high"'));
  assert.ok(!markup.includes('Password requirements'));
  assert.ok(!markup.includes('staff-apply-name'));
});

test('application mode renders the structured Moderator application without changing auth fields', () => {
  const markup = renderToStaticMarkup(React.createElement(StaffPortalAuthScreen, {
    onSignIn: async () => {},
    onRegisterAndApply: async () => {},
    onForgotPassword: async () => {},
    initialMode: 'apply',
  }));

  assert.ok(markup.includes('Apply as Moderator.'));
  assert.ok(markup.includes('Application details'));
  assert.ok(markup.includes('Staff access is reviewed before it is granted.'));
  assert.ok(markup.includes('class="wc-apply-form"'));
  assert.ok(markup.includes('for="staff-apply-name"'));
  assert.ok(markup.includes('autoComplete="name"'));
  assert.ok(markup.includes('for="staff-auth-email"'));
  assert.ok(markup.includes('type="email"'));
  assert.ok(markup.includes('autoComplete="username"'));
  assert.ok(markup.includes('for="staff-auth-password"'));
  assert.ok(markup.includes('autoComplete="new-password"'));
  assert.ok(markup.includes('Password requirements'));
  assert.ok(markup.includes('staff-password-requirements'));
  assert.ok(markup.includes('Create account and apply'));
  assert.ok(markup.includes('does not grant staff access immediately'));
  assert.ok(markup.includes('Already have an account?'));
  assert.ok(!markup.includes('Forgot password?'));
  assert.ok(!markup.includes('staff-sign-in-title'));
});

test('forgot-password mode is a focused enumeration-safe auth state', () => {
  const markup = renderToStaticMarkup(React.createElement(StaffPortalAuthScreen, {
    onSignIn: noop,
    onRegisterAndApply: noop,
    onForgotPassword: noop,
    initialMode: 'forgot',
  }));

  assert.ok(markup.includes('Account recovery'));
  assert.ok(markup.includes('Forgot your password?'));
  assert.ok(markup.includes('for="staff-forgot-email"'));
  assert.ok(markup.includes('Send Reset Instructions'));
  assert.ok(markup.includes('Back to Sign In'));
  assert.ok(markup.includes('when the account is eligible'));
  assert.ok(!markup.includes('staff-auth-password'));
});

test('reset password renders ready, invalid, and success states without exposing its token', () => {
  const props = { token: 'secret-reset-token', onClearToken: noop, onDone: noop };
  const ready = renderToStaticMarkup(React.createElement(ResetPasswordScreen, props));
  const invalid = renderToStaticMarkup(React.createElement(ResetPasswordScreen, { ...props, initialStatus: 'invalid' }));
  const done = renderToStaticMarkup(React.createElement(ResetPasswordScreen, { ...props, initialStatus: 'done' }));

  assert.ok(ready.includes('Reset your password'));
  assert.ok(ready.includes('for="reset-new-password"'));
  assert.ok(ready.includes('for="reset-confirm-password"'));
  assert.ok(ready.includes('Password requirements'));
  assert.ok(ready.includes('Save new password'));
  assert.ok(invalid.includes('Reset link unavailable'));
  assert.ok(invalid.includes('invalid, expired, or has already been used'));
  assert.ok(invalid.includes('Back to Sign In'));
  assert.ok(done.includes('Password updated'));
  assert.ok(done.includes('Continue to Sign In'));
  assert.ok(!ready.includes(props.token));
  assert.ok(!invalid.includes(props.token));
  assert.ok(!done.includes(props.token));
});

test('active staff access states use the shared supporting-auth treatment and real actions', () => {
  const common = { onSignOut: noop };
  const consumer = renderToStaticMarkup(React.createElement(ConsumerScreen, {
    ...common, user: { email: 'cook@example.com' }, notice: '', onApply: noop,
  }));
  const verify = renderToStaticMarkup(React.createElement(VerifyEmailState, {
    ...common, user: { email: 'cook@example.com' }, onResend: noop, onRefresh: noop,
  }));
  const pending = renderToStaticMarkup(React.createElement(PendingState, {
    ...common, onRefresh: noop,
  }));
  const rejected = renderToStaticMarkup(React.createElement(RejectedState, {
    ...common, reason: 'More detail is needed.', onApplyAgain: noop,
  }));
  const rejectedWithoutReason = renderToStaticMarkup(React.createElement(RejectedState, {
    ...common, onApplyAgain: noop,
  }));
  const bootstrapError = renderToStaticMarkup(React.createElement(StaffBootstrapError, {
    ...common, message: 'Unable to load your access status.', onRetry: noop,
  }));

  for (const markup of [consumer, verify, pending, rejected, bootstrapError]) {
    assert.ok(markup.includes('class="wc-support-auth"'));
    assert.ok(markup.includes('Sign Out'));
  }
  assert.ok(consumer.includes('Account active'));
  assert.ok(consumer.includes('valid account'));
  assert.ok(consumer.includes('Apply as Moderator'));
  assert.ok(verify.includes('Verify your email'));
  assert.ok(verify.includes('Resend Verification Email'));
  assert.ok(verify.includes('Refresh Status'));
  assert.ok(pending.includes('Under review'));
  assert.ok(pending.includes('don’t provide an approval timeline'));
  assert.ok(rejected.includes('More detail is needed.'));
  assert.ok(rejected.includes('Apply Again'));
  assert.ok(!rejectedWithoutReason.includes('wc-support-auth__reason'));
  assert.ok(bootstrapError.includes('Staff Portal unavailable'));
  assert.ok(bootstrapError.includes('Try Again'));
});
