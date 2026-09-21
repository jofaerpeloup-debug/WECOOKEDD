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
        import { NEW_PASSWORD_ERROR_MESSAGES } from '@wecooked/contracts';
        export const minimumPasswordMessage = NEW_PASSWORD_ERROR_MESSAGES.MIN_CHARS;
      `;
    },
  };
}

test('Staff production config bundles named exports from the CommonJS contracts workspace', async () => {
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
  } finally {
    try {
      await server?.close();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  }
});
