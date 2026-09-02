// §32 — config plugin (modules/wecooked-google-signin/app.plugin.js).
//
// No native project directories are generated. Pure transforms + the
// both/one/none branching are tested directly.

const plugin = require('../modules/wecooked-google-signin/app.plugin.js');

const {
  WEB_CLIENT_ID_RESOURCE,
  reversedClientScheme,
  setWebClientIdStringResource,
  applyIosGoogleInfoPlist,
  withWeCookedGoogleSignIn,
} = plugin._internal;

const IOS_CLIENT_ID = '123456789-abcdefg.apps.googleusercontent.com';
const REVERSED = 'com.googleusercontent.apps.123456789-abcdefg';

describe('reversedClientScheme', () => {
  it('reverses a standard iOS client id', () => {
    expect(reversedClientScheme(IOS_CLIENT_ID)).toBe(REVERSED);
  });
});

describe('config resolution branching (both / one / none)', () => {
  const baseConfig = () => ({ name: 'WeCooked', slug: 'wecooked' });

  it('BOTH ids absent -> config returned unchanged, no Google injection', () => {
    const cfg = baseConfig();
    const out = withWeCookedGoogleSignIn(cfg, {});
    expect(out).toBe(cfg);
    expect(out.mods).toBeUndefined();
  });

  it('EXACTLY ONE id -> configuration fails', () => {
    expect(() => withWeCookedGoogleSignIn(baseConfig(), { googleWebClientId: 'web' })).toThrow(
      /incomplete/i
    );
    expect(() => withWeCookedGoogleSignIn(baseConfig(), { googleIosClientId: IOS_CLIENT_ID })).toThrow(
      /incomplete/i
    );
  });

  it('BOTH ids present -> Android strings + iOS infoPlist mods are registered', () => {
    const out = withWeCookedGoogleSignIn(baseConfig(), {
      googleWebClientId: 'web-server-id',
      googleIosClientId: IOS_CLIENT_ID,
    });
    expect(out.mods.android.strings).toBeDefined();
    expect(out.mods.ios.infoPlist).toBeDefined();
  });
});

describe('Android — Web/server client id string resource', () => {
  it('inserts a non-translatable string resource with the dedicated name', () => {
    const xml = setWebClientIdStringResource({ resources: {} }, 'WEB_SERVER_ID');
    const item = xml.resources.string.find((s) => s.$.name === WEB_CLIENT_ID_RESOURCE);
    expect(item).toBeDefined();
    expect(item._).toBe('WEB_SERVER_ID');
    expect(item.$.translatable).toBe('false');
    expect(WEB_CLIENT_ID_RESOURCE).toBe('wecooked_google_web_client_id');
  });

  it('is idempotent — re-applying does not duplicate the resource', () => {
    let xml = setWebClientIdStringResource({ resources: {} }, 'WEB_SERVER_ID');
    xml = setWebClientIdStringResource(xml, 'WEB_SERVER_ID');
    const matches = xml.resources.string.filter((s) => s.$.name === WEB_CLIENT_ID_RESOURCE);
    expect(matches).toHaveLength(1);
  });

  it('does not add any Google manifest auth entry (plugin never touches the manifest)', () => {
    const out = withWeCookedGoogleSignIn(
      { name: 'x' },
      { googleWebClientId: 'web', googleIosClientId: IOS_CLIENT_ID }
    );
    expect(out.mods.android?.manifest).toBeUndefined();
  });
});

describe('iOS — Info.plist', () => {
  const freshPlist = () => ({ CFBundleURLTypes: [{ CFBundleURLSchemes: ['wecooked'] }] });

  it('sets GIDClientID + GIDServerClientID and appends the reversed scheme, preserving wecooked', () => {
    const out = applyIosGoogleInfoPlist(freshPlist(), {
      webClientId: 'WEB',
      iosClientId: IOS_CLIENT_ID,
    });
    expect(out.GIDClientID).toBe(IOS_CLIENT_ID);
    expect(out.GIDServerClientID).toBe('WEB');
    const schemes = out.CFBundleURLTypes.flatMap((t) => t.CFBundleURLSchemes || []);
    expect(schemes).toContain('wecooked');
    expect(schemes).toContain(REVERSED);
  });

  it('is idempotent — re-applying does not duplicate the reversed scheme', () => {
    let out = applyIosGoogleInfoPlist(freshPlist(), { webClientId: 'WEB', iosClientId: IOS_CLIENT_ID });
    out = applyIosGoogleInfoPlist(out, { webClientId: 'WEB', iosClientId: IOS_CLIENT_ID });
    const schemes = out.CFBundleURLTypes.flatMap((t) => t.CFBundleURLSchemes || []);
    expect(schemes.filter((s) => s === REVERSED)).toHaveLength(1);
    expect(schemes.filter((s) => s === 'wecooked')).toHaveLength(1);
  });

});

describe('prohibited behavior (not comment-word scanning)', () => {
  const fs = require('fs');
  const path = require('path');

  const PLUGIN_PATH = path.join(__dirname, '../modules/wecooked-google-signin/app.plugin.js');
  const rawSource = fs.readFileSync(PLUGIN_PATH, 'utf8');

  // Executable source only — // line comments and /* */ blocks removed, and
  // string-literal contents blanked — so a word that legitimately appears in a
  // truthful comment ("no google-services.json is written") or would only be
  // matched inside a message string can't trip these checks.
  const codeOnly = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const codeNoStrings = codeOnly.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '$1$1');

  // Every module the plugin pulls in.
  const requiredModules = [...codeOnly.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (m) => m[1]
  );

  it('imports nothing but expo/config-plugins', () => {
    expect(requiredModules).toEqual(['expo/config-plugins']);
  });

  it('pulls in no Firebase / google-services / Google-wrapper package', () => {
    for (const spec of requiredModules) {
      expect(spec).not.toMatch(/firebase/i);
      expect(spec).not.toMatch(/google-services/i);
      expect(spec).not.toMatch(/@react-native-google-signin/);
      expect(spec).not.toMatch(/google-signin/i);
    }
  });

  it('never calls withAppDelegate or withDangerousMod', () => {
    expect(codeNoStrings).not.toMatch(/\bwithAppDelegate\s*\(/);
    expect(codeNoStrings).not.toMatch(/\bwithDangerousMod\s*\(/);
    // ...and does not even import those names from config-plugins.
    expect(codeNoStrings).not.toMatch(/\bwithAppDelegate\b/);
    expect(codeNoStrings).not.toMatch(/\bwithDangerousMod\b/);
  });

  it('never references a GoogleService-Info.plist / google-services.json path in executable code or string literals', () => {
    expect(codeOnly).not.toMatch(/GoogleService-Info/);
    expect(codeOnly).not.toMatch(/google-services\.json/);
  });

  it('registers ONLY an Android strings mod and an iOS Info.plist mod — nothing else', () => {
    const out = withWeCookedGoogleSignIn(
      { name: 'WeCooked', slug: 'wecooked' },
      { googleWebClientId: 'web-server-id', googleIosClientId: IOS_CLIENT_ID }
    );

    expect(Object.keys(out.mods).sort()).toEqual(['android', 'ios']);
    expect(Object.keys(out.mods.android)).toContain('strings');
    expect(Object.keys(out.mods.ios)).toContain('infoPlist');

    // Explicitly: no dangerous mod, no AppDelegate mod, no manifest mod, no
    // gradle/google-services mod.
    expect(out.mods.ios.dangerousMod).toBeUndefined();
    expect(out.mods.ios.appDelegate).toBeUndefined();
    expect(out.mods.android.dangerousMod).toBeUndefined();
    expect(out.mods.android.manifest).toBeUndefined();
    expect(out.mods.android.gradleProperties).toBeUndefined();
    expect(out.mods.android.projectBuildGradle).toBeUndefined();
    expect(out.mods.android.appBuildGradle).toBeUndefined();
  });

  it('the iOS Info.plist mutation sets only the Google client keys + reversed scheme', () => {
    const infoPlist = applyIosGoogleInfoPlist(
      { CFBundleURLTypes: [{ CFBundleURLSchemes: ['wecooked'] }] },
      { webClientId: 'WEB', iosClientId: IOS_CLIENT_ID }
    );
    // Only these keys are added by the plugin (plus the pre-existing URL types).
    const addedKeys = Object.keys(infoPlist).filter((k) => k !== 'CFBundleURLTypes');
    expect(addedKeys.sort()).toEqual(['GIDClientID', 'GIDServerClientID']);
    // No Firebase-style keys.
    expect(infoPlist).not.toHaveProperty('FirebaseAppDelegateProxyEnabled');
    expect(infoPlist).not.toHaveProperty('GoogleService');
  });
});