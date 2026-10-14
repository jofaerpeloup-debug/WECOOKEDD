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
const dashboardCss = fs.readFileSync(path.join(adminRoot, 'src/styles/dashboard.css'), 'utf8');
const server = await createServer({
  root: adminRoot,
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
  ssr: { external: ['@wecooked/contracts'] },
});

let ModeratorWorkspace;
let OverviewTab;
let RecipeAuthoringSteps;
let loadRecipeDashboardData;
try {
  ({
    ModeratorWorkspace,
    OverviewTab,
    loadRecipeDashboardData,
  } = await server.ssrLoadModule('/src/App.jsx'));
  ({ default: RecipeAuthoringSteps } = await server.ssrLoadModule('/src/recipeAuthoring/RecipeAuthoringSteps.jsx'));
} catch (error) {
  await server.close();
  throw error;
}

test.after(async () => {
  await server.close();
});

const analyticsEndUtc = '2026-10-12T04:00:00.000Z';
const analyticsBuckets = Array.from({ length: 90 }, (_, index) => {
  const localMidnight = new Date('2026-10-12T00:00:00.000Z');
  localMidnight.setUTCDate(localMidnight.getUTCDate() - (89 - index));
  const fromUtc = new Date(localMidnight.getTime() - 8 * 60 * 60 * 1000);
  const nextMidnight = new Date(localMidnight);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  return {
    localDate: localMidnight.toISOString().slice(0, 10),
    fromUtc: fromUtc.toISOString(),
    toUtc: index === 89 ? analyticsEndUtc
      : new Date(nextMidnight.getTime() - 8 * 60 * 60 * 1000).toISOString(),
    accountsRegistered: 0,
    postsCreated: 0,
  };
});

const analyticsState = {
  status: 'ready',
  data: {
    periodEndUtc: analyticsEndUtc,
    generatedAtUtc: '2026-10-12T04:00:01.000Z',
    timeZone: 'Asia/Manila',
    accounts: {
      total: 117,
      byRole: { user: 110, moderator: 5, admin: 2 },
      byStatus: { active: 104, suspended: 13 },
      eligibleActive: 100,
    },
    communityPosts: { retainedTotal: 39 },
    periods: Object.fromEntries([7, 30, 90].map((days) => {
      const selected = analyticsBuckets.slice(-days);
      return [`days${days}`, {
        fromUtc: selected[0].fromUtc,
        toUtc: analyticsEndUtc,
        accountsRegistered: selected.reduce((total, bucket) => total + bucket.accountsRegistered, 0),
        postsCreated: selected.reduce((total, bucket) => total + bucket.postsCreated, 0),
      }];
    })),
    daily: { buckets: analyticsBuckets },
  },
};

function renderOverview(overrides = {}) {
  return renderToStaticMarkup(React.createElement(OverviewTab, {
    totalRecipes: 42,
    latestRecipes: [{ id: 'recipe-1', title: 'Real API Recipe', category: 'dinner' }],
    recipeStatus: 'ready',
    analyticsState,
    onNavigate: () => {},
    ...overrides,
  }));
}

test('recipe dashboard loader uses the authoritative total and preserves newest results', async () => {
  const calls = [];
  const recipes = [
    { id: 'r1', title: 'Newest One', category: 'dinner' },
    { id: 'r2', title: 'Newest Two', category: 'lunch' },
    { id: 'r3', title: 'Newest Three', category: 'snack' },
    { id: 'r4', title: 'Newest Four', category: 'breakfast' },
    { id: 'r5', title: 'Older Recipe', category: 'dinner' },
  ];
  const state = await loadRecipeDashboardData(async (params) => {
    calls.push(params);
    return { recipes, pagination: { total: 41 } };
  });

  assert.deepEqual(calls, [{ status: 'all', sort: 'newest', page: 1, limit: 100 }]);
  assert.deepEqual(state, { status: 'ready', total: 41, latest: recipes.slice(0, 4) });

  const markup = renderOverview({
    totalRecipes: state.total,
    latestRecipes: state.latest,
    recipeStatus: state.status,
  });
  assert.match(markup, />41</);
  assert.ok(markup.indexOf('Newest One') < markup.indexOf('Newest Four'));
  assert.doesNotMatch(markup, /Older Recipe/);
});

test('dashboard loaders accept authoritative zero totals', async () => {
  const recipeState = await loadRecipeDashboardData(async () => ({
    recipes: [],
    pagination: { total: 0 },
  }));
  assert.deepEqual(recipeState, { status: 'ready', total: 0, latest: [] });
  assert.match(renderOverview({
    totalRecipes: 0,
    latestRecipes: [],
  }), />0</);
});

test('recipe dashboard loader never substitutes page length for an invalid total', async () => {
  const invalidTotals = [undefined, null, '5', NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, {}];

  for (const total of invalidTotals) {
    const state = await loadRecipeDashboardData(async () => ({
      recipes: [{ id: 'r1', title: 'Page Recipe' }],
      pagination: total === undefined ? {} : { total },
    }));
    assert.deepEqual(state, { status: 'error', total: 0, latest: [] });
  }
});

test('rejected dashboard requests produce unavailable states without error details', async () => {
  const rejected = async () => { throw new Error('sensitive upstream detail'); };

  assert.deepEqual(
    await loadRecipeDashboardData(rejected),
    { status: 'error', total: 0, latest: [] },
  );
});

test('Admin Overview presents only supported REST-backed totals and latest recipes', () => {
  const markup = renderOverview();

  for (const value of ['42', '117', '104', '13', 'Real API Recipe', 'Dinner']) {
    assert.match(markup, new RegExp(`>${value}<`));
  }
  assert.match(markup, /Admin Overview/);
  assert.match(markup, /Latest recipes/);
  assert.equal((markup.match(/wc-dashboard-stat-icon/g) || []).length, 1);
  assert.match(markup, /Active-status accounts/);
});

test('Admin Overview rejects a ready Analytics response missing daily buckets', () => {
  const invalidData = { ...analyticsState.data };
  delete invalidData.daily;
  const markup = renderOverview({ analyticsState: { status: 'ready', data: invalidData } });

  assert.match(markup, /Analytics could not be loaded/);
  assert.doesNotMatch(markup, />117<|>104<|>13</);
  assert.match(markup, /Real API Recipe/);
});

test('Admin metadata controls render the exact ordered Region/category labels and unset choices', () => {
  const markup = renderToStaticMarkup(React.createElement(RecipeAuthoringSteps, {
    authoring: {
      state: {
        currentStep: 'details',
        fieldErrors: {},
        form: {
          difficulty: '', prepTimeMinutes: '', cookTimeHours: '', cookTimeMinutePart: '',
          servings: '', region: '', category: '', dietaryTags: [], nutrition: null,
        },
      },
      change: () => {},
      busy: false,
    },
    canUploadRecipeImage: false,
    onAuthorityLost: () => {},
  }));
  const regionSelect = markup.match(/<label>Region<select[\s\S]*?<\/select><\/label>/)?.[0];
  const categorySelect = markup.match(/<label>Category<select[\s\S]*?<\/select><\/label>/)?.[0];
  assert.ok(regionSelect);
  assert.ok(categorySelect);
  assert.deepEqual([...regionSelect.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((match) => match.slice(1)), [
    ['', 'Not set'],
    ['national-capital-region', 'National Capital Region (NCR)'],
    ['cordillera-administrative-region', 'Cordillera Administrative Region (CAR)'],
    ['ilocos-region', 'Ilocos Region'], ['cagayan-valley', 'Cagayan Valley'],
    ['central-luzon', 'Central Luzon'], ['calabarzon', 'CALABARZON'],
    ['mimaropa-region', 'MIMAROPA Region'], ['bicol-region', 'Bicol Region'],
    ['western-visayas', 'Western Visayas'], ['negros-island-region', 'Negros Island Region (NIR)'],
    ['central-visayas', 'Central Visayas'], ['eastern-visayas', 'Eastern Visayas'],
    ['zamboanga-peninsula', 'Zamboanga Peninsula'], ['northern-mindanao', 'Northern Mindanao'],
    ['davao-region', 'Davao Region'], ['soccsksargen', 'SOCCSKSARGEN'],
    ['caraga', 'Caraga'],
    ['bangsamoro-autonomous-region-in-muslim-mindanao', 'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)'],
  ]);
  assert.deepEqual([...categorySelect.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((match) => match.slice(1)), [
    ['', 'Not set'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'],
    ['dinner', 'Dinner'], ['snack', 'Snack'],
  ]);
});

test('legacy metadata display is non-fatal and does not fabricate a canonical label', () => {
  const markup = renderOverview({
    latestRecipes: [
      { id: 'legacy-1', title: 'Legacy Tondo Recipe', region: 'tondo' },
      { id: 'legacy-2', title: 'Legacy Restaurant Recipe', category: 'fine-dining-restaurant' },
    ],
  });
  assert.match(markup, /Legacy Tondo Recipe/);
  assert.match(markup, /Legacy Restaurant Recipe/);
  assert.equal((markup.match(/<small>Recipe<\/small>/g) || []).length, 2);
});

test('fabricated trends, activity, and chart data are removed from the dashboard source', () => {
  for (const unsupportedContent of [
    'growthData',
    'activityFeed',
    '+12 this month',
    '+8% this month',
    'Growth, last 6 months',
    'Recent activity',
    'ResponsiveContainer',
  ]) {
    assert.doesNotMatch(appSource, new RegExp(unsupportedContent.replace(/[+]/g, '\\+')));
  }
});

test('Admin quick access remains read-only for catalog work and keeps existing tab callbacks', () => {
  const markup = renderOverview();

  assert.match(markup, /Users/);
  assert.match(markup, /Staff Management/);
  assert.match(markup, /Recipe catalog/);
  assert.match(markup, /Open read-only catalog access/);
  assert.doesNotMatch(markup, /Create recipe|Upload image|Ingredients|Substitutions/);
  assert.match(appSource, /onClick=\{\(\) => onNavigate\('users'\)\}/);
  assert.match(appSource, /onClick=\{\(\) => onNavigate\('staff'\)\}/);
  assert.match(appSource, /onClick=\{\(\) => onNavigate\('recipes'\)\}/);
});

test('Admin Overview distinguishes loading, empty, and error recipe states', () => {
  assert.match(renderOverview({ recipeStatus: 'loading' }), /Loading recipe data/);
  assert.match(renderOverview({ latestRecipes: [] }), /No recipes are currently in the catalog/);

  const errorMarkup = renderOverview({ recipeStatus: 'error', analyticsState: { status: 'error', data: null } });
  assert.match(errorMarkup, /Some overview data could not be loaded/);
  assert.match(errorMarkup, /Recipe data is unavailable/);
  assert.doesNotMatch(errorMarkup, />0</);
});

test('Moderator home exposes only its three catalog work areas', () => {
  const markup = renderToStaticMarkup(React.createElement(ModeratorWorkspace, {
    tab: 'moderator-home',
    setTab: () => {},
    identity: { name: 'Morgan Cook', email: 'moderator@example.test' },
    catalogPolicy: { canWriteCatalog: true, canUploadRecipeImage: true },
    onSignOut: () => {},
    onAuthorityLost: () => {},
  }));

  assert.match(markup, /Moderator Workspace/);
  assert.match(markup, /Recipes/);
  assert.match(markup, /Ingredients/);
  assert.match(markup, /Substitutions/);
  assert.doesNotMatch(markup, /User Management|Staff Management|Audit Logs|Monitoring/);
  for (const destination of ['recipes', 'ingredients', 'substitutions']) {
    assert.match(appSource, new RegExp(`onClick=\\{\\(\\) => setTab\\(${JSON.stringify(destination).replaceAll('"', "'")}\\)\\}`));
  }
});

test('dashboard styling is namespaced, responsive, and uses semantic colors', () => {
  assert.match(dashboardCss, /^\.wc-admin \.wc-dashboard/m);
  assert.match(dashboardCss, /\.wc-dashboard-columns\s*\{[^}]*align-items:\s*stretch/s);
  assert.match(dashboardCss, /\.wc-dashboard-shortcuts\s*\{[^}]*grid-template-rows:\s*repeat\(3, minmax\(58px, 1fr\)\)/s);
  assert.match(dashboardCss, /@media \(max-width: 900px\)/);
  assert.match(dashboardCss, /@media \(max-width: 700px\)/);
  assert.match(dashboardCss, /@media \(max-width: 480px\)/);
  assert.doesNotMatch(dashboardCss, /#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(dashboardCss, /^button\s*\{/m);
});
