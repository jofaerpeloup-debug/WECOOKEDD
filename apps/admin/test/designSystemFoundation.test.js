import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokensCss = fs.readFileSync(path.join(adminRoot, 'src/styles/tokens.css'), 'utf8');
const baseCss = fs.readFileSync(path.join(adminRoot, 'src/styles/base.css'), 'utf8');

const semanticTokens = [
  '--background',
  '--background-subtle',
  '--surface',
  '--surface-elevated',
  '--surface-strong',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--text-inverse',
  '--border',
  '--border-strong',
  '--primary',
  '--primary-hover',
  '--primary-active',
  '--primary-foreground',
  '--accent',
  '--highlight',
  '--success',
  '--warning',
  '--destructive',
  '--input-background',
  '--input-border',
  '--input-border-focus',
  '--focus-ring',
  '--shadow-soft',
  '--shadow-dialog',
];

function declarationsFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tokensCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Expected token scope ${selector}`);

  return new Map(
    [...match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value.trim()]),
  );
}

function relativeLuminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map((channel) => parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));

  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

test('light and dark themes define every required semantic token', () => {
  const light = declarationsFor('.wc-admin');
  const dark = declarationsFor('.wc-admin.wc-dark');

  for (const token of semanticTokens) {
    assert.ok(light.get(token), `Missing light value for ${token}`);
    assert.ok(dark.get(token), `Missing dark value for ${token}`);
  }
});

test('brand anchors preserve the approved palette hierarchy', () => {
  const light = declarationsFor('.wc-admin');

  assert.equal(light.get('--primary').toLowerCase(), '#023820');
  assert.equal(light.get('--background').toLowerCase(), '#fff4e6');
  assert.equal(light.get('--accent').toLowerCase(), '#ee3f24');
  assert.equal(light.get('--highlight').toLowerCase(), '#f9a11b');
  assert.ok(light.get('--focus-ring'));
});

test('theme focus rings maintain non-text contrast against intended surfaces', () => {
  const light = declarationsFor('.wc-admin');
  const dark = declarationsFor('.wc-admin.wc-dark');

  for (const surface of ['#fff4e6', '#ffffff', '#faf9f6']) {
    assert.ok(
      contrastRatio(light.get('--focus-ring'), surface) >= 3,
      `Expected light focus ring to maintain 3:1 contrast against ${surface}`,
    );
  }

  assert.ok(
    contrastRatio(dark.get('--focus-ring'), dark.get('--background')) >= 3,
    'Expected dark focus ring to remain distinct from the dark background',
  );
});

test('layout, type, and motion foundations stay available', () => {
  const light = declarationsFor('.wc-admin');
  const groups = [
    ['spacing', ['--space-1', '--space-4', '--space-8']],
    ['radii', ['--radius-sm', '--radius-md', '--radius-lg']],
    ['borders', ['--border-width', '--border-width-strong']],
    ['control heights', ['--control-height-sm', '--control-height-md', '--control-height-lg']],
    ['motion', ['--motion-duration-fast', '--motion-duration-base', '--motion-easing-standard']],
    ['typography', ['--font-ui', '--font-display']],
  ];

  for (const [group, tokens] of groups) {
    for (const token of tokens) {
      assert.ok(light.get(token), `Missing ${group} foundation ${token}`);
    }
  }
});

test('base styles provide focus and reduced-motion safeguards', () => {
  assert.match(baseCss, /\.wc-admin\s+\*:focus-visible\s*\{[^}]*var\(--focus-ring/);
  assert.match(baseCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(baseCss, /\.wc-admin\s+\*,\s*\.wc-admin\s+\*::before,\s*\.wc-admin\s+\*::after\s*\{/);
  assert.match(baseCss, /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(baseCss, /animation-iteration-count:\s*1\s*!important/);
  assert.match(baseCss, /transition-duration:\s*0\.01ms\s*!important/);
});
