import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => fs.readFileSync(path.join(adminRoot, 'src', file), 'utf8');
const pageFiles = [
  'RecipesTab.jsx',
  'IngredientsTab.jsx',
  'SubstitutionsTab.jsx',
  'UsersTab.jsx',
  'StaffManagementTab.jsx',
  'AuditLogsTab.jsx',
];

test('every management page places the shared pagination before its results table', () => {
  for (const file of pageFiles) {
    const contents = source(file);
    const pagination = contents.lastIndexOf('<ManagementPagination');
    const standardTable = contents.lastIndexOf('<div className="wc-table-wrap"');
    const table = standardTable >= 0
      ? standardTable
      : contents.lastIndexOf('<div className="wc-audit-table-wrap"');

    assert.ok(contents.includes('wc-management-page'), `${file} uses the management page system`);
    assert.ok(pagination >= 0, `${file} renders shared pagination`);
    assert.ok(table >= 0, `${file} renders a contained results table`);
    assert.ok(pagination < table, `${file} pagination appears above results`);
  }
});

test('management tables contain overflow and replace amber focus with the green system', () => {
  const css = source('styles/management.css');
  assert.match(css, /\.wc-table-wrap\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /:focus-visible[^}]*outline:\s*2px solid var\(--input-border-focus\)/s);
  assert.doesNotMatch(css, /var\(--highlight\)|#f9a11b/i);
  assert.match(css, /@media \(max-width: 620px\)/);
});

test('management headers and controls use the compact utility density', () => {
  const css = source('styles/management.css');
  assert.match(css, /\.wc-management-page > \.wc-topbar h1,[^{]+\{[^}]*font-size:\s*1\.625rem/s);
  assert.match(css, /\.wc-management-page \.wc-search\s*\{[^}]*max-width:\s*300px/s);
  assert.match(css, /\.wc-audit-filter-grid select\s*\{[^}]*height:\s*40px/s);
  assert.match(css, /\.wc-management-pagination\s*\{[^}]*min-height:\s*40px[^}]*padding:\s*5px 0/s);
  assert.match(css, /\.wc-rcp-count-note\s*\{[^}]*font-size:\s*0\.72rem[^}]*line-height:\s*1\.35/s);
});

test('recipe actions retain the existing role gate', () => {
  const recipes = source('RecipesTab.jsx');
  assert.match(recipes, /!canWrite && <span className="wc-pill active">Read-only<\/span>/);
  assert.match(recipes, /canWrite && <button className="wc-btn-primary"[^>]*>.*Add recipe/s);
  assert.match(recipes, /canWrite \? .* : 'View'/s);
  assert.match(recipes, /\{canWrite && \(recipe\.isActive/);
});
