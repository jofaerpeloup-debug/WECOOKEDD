// Dynamic Expo config. Preserves app.json verbatim and adds ONLY the
// build-time Google native configuration when it is fully provided.
//
// B4.2A is credential-free: with neither env var set (the normal case for now)
// this resolves successfully and the Google native config stays unset, so the
// current Expo workflow and the credential-free review both keep working.
//
// The Google client IDs are read from PROCESS ENV at config time and passed
// ONLY as config-plugin props. They are never placed under Expo `extra` and
// never exposed as `EXPO_PUBLIC_*` (JS/runtime must not receive them).
//
//   GOOGLE_WEB_CLIENT_ID  — Web/server OAuth client ID (backend-verified `aud`)
//   GOOGLE_IOS_CLIENT_ID  — iOS OAuth client ID (bundle identity + URL scheme)
//
// Android's own OAuth client is associated later in Google Cloud via
// com.wecooked.app + signing-cert fingerprints (B4.2B) — no Android platform
// client ID is needed here.

const { expo: base } = require('./app.json');

// Shape of a real Google OAuth client ID (e.g.
// "123456789-abc123.apps.googleusercontent.com"). Both the web and iOS client
// IDs are validated against this before they are ever passed to the config
// plugin, so a malformed value (truncated paste, wrong field, shell-command
// injection, etc.) fails config evaluation instead of reaching a native build.
const GOOGLE_CLIENT_ID_PATTERN = /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;

const WEB_CLIENT_ID = (process.env.GOOGLE_WEB_CLIENT_ID || '').trim();
const IOS_CLIENT_ID = (process.env.GOOGLE_IOS_CLIENT_ID || '').trim();

// Fixed, safe error — identifies which env var is malformed and never echoes
// the offending value (it must never appear in a thrown message, a log, or
// anywhere else reachable from build output).
function assertValidGoogleClientId(name, value) {
  if (!GOOGLE_CLIENT_ID_PATTERN.test(value)) {
    throw new Error(
      `WeCooked Google sign-in configuration is invalid: ${name} is not a ` +
        'well-formed Google OAuth client ID.'
    );
  }
}

module.exports = () => {
  const haveWeb = WEB_CLIENT_ID.length > 0;
  const haveIos = IOS_CLIENT_ID.length > 0;

  if (haveWeb !== haveIos) {
    throw new Error(
      'WeCooked Google sign-in configuration is incomplete: set BOTH ' +
        'GOOGLE_WEB_CLIENT_ID and GOOGLE_IOS_CLIENT_ID, or neither. ' +
        '(B4.2A is credential-free — leaving both unset is expected.)'
    );
  }

  if (haveWeb && haveIos) {
    assertValidGoogleClientId('GOOGLE_WEB_CLIENT_ID', WEB_CLIENT_ID);
    assertValidGoogleClientId('GOOGLE_IOS_CLIENT_ID', IOS_CLIENT_ID);
  }
  const plugins = [
    ...(base.plugins || []),
    [
      'expo-build-properties',
      {
        ios: {
          extraPods: [
            {
              name: 'GoogleUtilities',
              modular_headers: true,
            },
            {
              name: 'RecaptchaInterop',
              modular_headers: true,
            },
          ],
        },
      },
    ],
  ];

  if (haveWeb && haveIos) {
    plugins.push([
      './modules/wecooked-google-signin/app.plugin.js',
      {
        googleWebClientId: WEB_CLIENT_ID,
        googleIosClientId: IOS_CLIENT_ID,
      },
    ]);
  }

  return {
    ...base,
    plugins,
  };
};