// §16 / §35 — app.config.js resolves in all three states and never leaks the
// Google client IDs into `extra` / EXPO_PUBLIC.

const IOS_CLIENT_ID = '123-abc.apps.googleusercontent.com';
const WEB_CLIENT_ID = 'web-server-oauth-client-id';

function loadConfig({ web, ios } = {}) {
  const saved = { web: process.env.GOOGLE_WEB_CLIENT_ID, ios: process.env.GOOGLE_IOS_CLIENT_ID };
  if (web === undefined) delete process.env.GOOGLE_WEB_CLIENT_ID;
  else process.env.GOOGLE_WEB_CLIENT_ID = web;
  if (ios === undefined) delete process.env.GOOGLE_IOS_CLIENT_ID;
  else process.env.GOOGLE_IOS_CLIENT_ID = ios;

  let result;
  let thrown;
  jest.isolateModules(() => {
    try {
      const fn = require('../app.config.js');
      result = fn();
    } catch (e) {
      thrown = e;
    }
  });

  process.env.GOOGLE_WEB_CLIENT_ID = saved.web;
  process.env.GOOGLE_IOS_CLIENT_ID = saved.ios;
  if (saved.web === undefined) delete process.env.GOOGLE_WEB_CLIENT_ID;
  if (saved.ios === undefined) delete process.env.GOOGLE_IOS_CLIENT_ID;

  if (thrown) throw thrown;
  return result;
}

const appJson = require('../app.json').expo;

describe('app.config.js — credential-free (both unset)', () => {
  it('resolves successfully and preserves the core native identity', () => {
    const c = loadConfig({});
    expect(c.scheme).toBe('wecooked');
    expect(c.ios.bundleIdentifier).toBe('com.wecooked.app');
    expect(c.android.package).toBe('com.wecooked.app');
    expect(c.newArchEnabled).toBe(true);
  });

  it('adds no Google config plugin and preserves the existing plugins list', () => {
    const c = loadConfig({});
    expect(c.plugins).toEqual(appJson.plugins);
    expect(JSON.stringify(c.plugins)).not.toMatch(/wecooked-google-signin/);
  });

  it('never places Google client IDs under extra or as EXPO_PUBLIC values', () => {
    const c = loadConfig({ web: WEB_CLIENT_ID, ios: IOS_CLIENT_ID });
    const serialized = JSON.stringify(c);
    expect(c.extra?.GOOGLE_WEB_CLIENT_ID).toBeUndefined();
    expect(c.extra?.GOOGLE_IOS_CLIENT_ID).toBeUndefined();
    expect(serialized).not.toMatch(/EXPO_PUBLIC_GOOGLE/);
    expect(serialized).not.toMatch(/clientSecret|client_secret/i);
  });
});

describe('app.config.js — incomplete (exactly one set)', () => {
  it('fails clearly when only the web id is set', () => {
    expect(() => loadConfig({ web: WEB_CLIENT_ID })).toThrow(/incomplete/i);
  });
  it('fails clearly when only the ios id is set', () => {
    expect(() => loadConfig({ ios: IOS_CLIENT_ID })).toThrow(/incomplete/i);
  });
});

describe('app.config.js — configured (both set)', () => {
  it('appends the local config plugin with both IDs passed ONLY as plugin props', () => {
    const c = loadConfig({ web: WEB_CLIENT_ID, ios: IOS_CLIENT_ID });
    const entry = c.plugins.find(
      (p) => Array.isArray(p) && String(p[0]).includes('wecooked-google-signin')
    );
    expect(entry).toBeDefined();
    expect(entry[1]).toEqual({
      googleWebClientId: WEB_CLIENT_ID,
      googleIosClientId: IOS_CLIENT_ID,
    });
    // original plugins still present
    for (const p of appJson.plugins) {
      expect(c.plugins).toContainEqual(p);
    }
  });
});