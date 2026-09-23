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
try {
  screenModule = await server.ssrLoadModule('/src/StaffPortalScreens.jsx');
} catch (error) {
  await server.close();
  throw error;
}
const { PasswordRequirements, StaffPortalAuthScreen } = screenModule;

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
