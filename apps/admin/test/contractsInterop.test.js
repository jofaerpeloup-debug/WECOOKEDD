import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, loadConfigFromFile, mergeConfig } from 'vite';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(adminRoot, 'vite.config.js');
const virtualEntryId = '\0virtual:contracts-interop-entry';

async function loadStaffConfig(command, mode) {
  const loaded = await loadConfigFromFile({ command, mode }, configPath, adminRoot);
  assert.ok(loaded, 'Expected Vite to load the Staff Portal configuration');
  return loaded.config;
}

function virtualContractsEntry() {
  return {
    name: 'contracts-interop-test-entry',
    resolveId(id) {
      return id === virtualEntryId ? id : null;
    },
    load(id) {
      if (id !== virtualEntryId) return null;

      return `
        import contracts from '@wecooked/contracts';
        const {
          INGREDIENT_CATEGORIES,
          INGREDIENT_CATEGORY_LABELS,
          NEW_PASSWORD_ERROR_MESSAGES,
          RECIPE_REGIONS,
          RECIPE_REGION_LABELS,
          RECIPE_CATEGORIES,
          RECIPE_CATEGORY_LABELS,
          RECIPE_DIETARY_TAGS,
        } = contracts;
        export const minimumPasswordMessage = NEW_PASSWORD_ERROR_MESSAGES.MIN_CHARS;
        export const ingredientCategories = INGREDIENT_CATEGORIES;
        export const soyCategoryLabel = INGREDIENT_CATEGORY_LABELS.soy;
        export const recipeRegions = RECIPE_REGIONS;
        export const recipeRegionLabels = RECIPE_REGION_LABELS;
        export const recipeCategories = RECIPE_CATEGORIES;
        export const recipeCategoryLabels = RECIPE_CATEGORY_LABELS;
        export const recipeDietaryTags = RECIPE_DIETARY_TAGS;
      `;
    },
  };
}

test('Staff production config bundles the CommonJS contracts workspace exports', async () => {
  const config = await loadStaffConfig('build', 'production');
  const result = await build(mergeConfig(config, {
    configFile: false,
    root: adminRoot,
    logLevel: 'silent',
    plugins: [virtualContractsEntry()],
    build: {
      write: false,
      rollupOptions: {
        input: virtualEntryId,
      },
    },
  }));

  assert.ok(result, 'Expected Vite to return an in-memory production bundle');
});

test('Staff development config optimizes and resolves the contracts workspace dependency', async () => {
  const config = await loadStaffConfig('serve', 'development');
  assert.equal(
    config.optimizeDeps?.force,
    true,
    'Expected development startup to refresh the mutable workspace contracts bundle',
  );
  assert.ok(
    config.optimizeDeps?.include?.includes('@wecooked/contracts'),
    'Expected the contracts workspace package in optimizeDeps.include',
  );

  const cacheDir = await mkdtemp(path.join(tmpdir(), 'wecooked-admin-vite-'));
  let server;

  try {
    server = await createServer(mergeConfig(config, {
      configFile: false,
      root: adminRoot,
      cacheDir,
      logLevel: 'silent',
      server: {
        middlewareMode: true,
      },
      ssr: { external: ['@wecooked/contracts'] },
    }));

    const importer = path.join(adminRoot, 'src', 'main.jsx');
    const resolved = await server.pluginContainer.resolveId('@wecooked/contracts', importer);

    assert.ok(resolved, 'Expected Vite development resolution to find @wecooked/contracts');
    assert.ok(
      resolved.id.replaceAll('\\', '/').startsWith(
        `${cacheDir.replaceAll('\\', '/')}/deps/@wecooked_contracts.js`,
      ),
      `Expected Vite to resolve the optimized contracts module, received ${resolved.id}`,
    );

    const transformed = await server.transformRequest('/src/recipeOptions.js');
    assert.ok(transformed, 'Expected the dev server to transform recipeOptions.js');
    assert.match(
      transformed.code,
      /const contracts = .*\.__esModule \? .*\.default :/,
      'Expected Vite to normalize the CommonJS default export before recipeOptions reads it',
    );
    assert.doesNotMatch(transformed.code, /import\s*\{[^}]*RECIPE_REGIONS[^}]*\}\s*from/);

    const options = await server.ssrLoadModule('/src/recipeOptions.js');
    assert.deepEqual(options.RECIPE_REGIONS.map(({ value, label }) => [value, label]), [
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
    assert.deepEqual(options.RECIPE_CATEGORIES.map(({ value, label }) => [value, label]), [
      ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack'],
    ]);
    assert.deepEqual(options.RECIPE_DIETARY_TAGS.map(({ value }) => value), [
      'vegetarian', 'vegan', 'pescatarian', 'glutenFree', 'dairyFree', 'nutFree',
    ]);
  } finally {
    try {
      await server?.close();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  }
});
