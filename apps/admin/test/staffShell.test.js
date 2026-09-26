import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(adminRoot, 'src/App.jsx'), 'utf8');
const shellCss = fs.readFileSync(path.join(adminRoot, 'src/styles/shell.css'), 'utf8');
const server = await createServer({
  root: adminRoot,
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
  ssr: { external: ['@wecooked/contracts'] },
});

let ProfileMenu;
try {
  ({ ProfileMenu } = await server.ssrLoadModule('/src/App.jsx'));
} catch (error) {
  await server.close();
  throw error;
}

test.after(async () => {
  await server.close();
});

const profileProps = {
  account: { name: 'Admin Cook', email: 'admin@wecooked.test' },
  onToggle: () => {},
  onClose: () => {},
  onSignOut: () => {},
  onOpenSettings: () => {},
  onOpenHelp: () => {},
  onOpenDisplay: () => {},
};

test('authenticated navigation exposes labels and current-page semantics', () => {
  assert.match(appSource, /<nav className="wc-nav" aria-label="Admin workspace">/);
  assert.match(appSource, /<nav className="wc-nav" aria-label="Moderator workspace">/);
  assert.match(appSource, /aria-current=\{tab === 'overview' \? 'page' : undefined\}/);
  assert.match(appSource, /aria-current=\{tab === 'moderator-home' \? 'page' : undefined\}/);
  assert.match(appSource, /aria-current=\{tab === id \? 'page' : undefined\}/);
});

test('Admin and Moderator navigation use role-appropriate visual groups', () => {
  assert.match(appSource, /className="wc-nav-section-label">Main/);
  assert.match(appSource, /className="wc-nav-section-label">Management/);
  assert.match(appSource, /className="wc-nav-section-label">Catalog/);
  assert.match(shellCss, /\.wc-nav-group/);
  assert.match(shellCss, /\.wc-nav-section-label/);
});

test('role and existing account treatments remain explicit for both workspaces', () => {
  assert.match(appSource, /<div className="wc-role-label">Admin<\/div>/);
  assert.match(appSource, /<div className="wc-role-label">Moderator<\/div>/);
  assert.match(appSource, /className="wc-nav-item wc-signout-item" onClick=\{onSignOut\}/);
});

test('closed Admin account trigger has a meaningful name without a dangling control', () => {
  const markup = renderToStaticMarkup(React.createElement(ProfileMenu, {
    ...profileProps,
    open: false,
  }));

  assert.match(markup, /<button[^>]*class="wc-profile-btn"[^>]*aria-label="Open account menu"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.doesNotMatch(markup, /aria-controls=/);
  assert.doesNotMatch(markup, /id="wc-account-menu"/);
});

test('open Admin account trigger accurately references its mounted account menu', () => {
  const markup = renderToStaticMarkup(React.createElement(ProfileMenu, {
    ...profileProps,
    open: true,
  }));

  assert.match(markup, /<button[^>]*class="wc-profile-btn"[^>]*aria-label="Close account menu"/);
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /aria-controls="wc-account-menu"/);
  assert.match(markup, /id="wc-account-menu"/);
});

test('shell styling stays scoped and covers required responsive widths', () => {
  assert.match(shellCss, /\.wc-admin \.wc-staff-sidebar/);
  assert.match(shellCss, /\.wc-admin \.wc-staff-main/);
  assert.match(shellCss, /@media \(max-width: 900px\)/);
  assert.match(shellCss, /@media \(max-width: 620px\)/);
  assert.match(shellCss, /overflow-x: auto/);
  assert.doesNotMatch(shellCss, /^button\s*\{/m);
});
