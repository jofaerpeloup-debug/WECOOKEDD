// Config plugin for the WeCooked local Google Sign-In module (B4.2A).
//
// Co-located with the module (single plugin tree). It owns BUILD-TIME injection
// of the Google OAuth client IDs into native config. JS never receives them.
//
// Props (passed only from apps/mobile/app.config.js, never from Expo `extra`):
//   googleWebClientId  — Web/server OAuth client ID (Android string resource +
//                        iOS GIDServerClientID). This is the audience the
//                        WeCooked backend (B4.1) verifies.
//   googleIosClientId  — iOS OAuth client ID (iOS GIDClientID + reversed-client
//                        URL scheme).
//
// Behavior:
//   * neither prop  -> no-op. Native Google config stays unset. Credential-free
//                      B4.2A review and the current Expo workflow stay usable.
//   * exactly one   -> throw (incomplete configuration).
//   * both props    -> apply Android + iOS native config, idempotently.
//
// It does NOT: add Google manifest auth entries, write google-services.json /
// GoogleService-Info.plist, patch AppDelegate source, or touch Firebase. The
// AppDelegate subscriber is registered via expo-module.config.json, not here.

// `expo/config-plugins` is the supported public re-export of
// `@expo/config-plugins` and resolves both under Expo's CLI and in plain Node
// (Jest) from this workspace.
const {
  withStringsXml,
  withInfoPlist,
  AndroidConfig,
  IOSConfig,
  createRunOncePlugin,
} = require('expo/config-plugins');

const WEB_CLIENT_ID_RESOURCE = 'wecooked_google_web_client_id';
const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

/**
 * "NNN-xxxx.apps.googleusercontent.com" -> "com.googleusercontent.apps.NNN-xxxx"
 * If the value is not in the expected form it is used as-is (the plugin does not
 * try to be clever about malformed input — a real build would fail loudly).
 */
function reversedClientScheme(iosClientId) {
  const core = iosClientId.endsWith(GOOGLE_CLIENT_ID_SUFFIX)
    ? iosClientId.slice(0, -GOOGLE_CLIENT_ID_SUFFIX.length)
    : iosClientId;
  return `com.googleusercontent.apps.${core}`;
}

/**
 * Pure transform: insert/replace the single Web/server client ID string
 * resource in a parsed strings.xml (ResourceXML). Idempotent — setStringItem
 * replaces an existing item with the same name.
 */
function setWebClientIdStringResource(stringsXml, webClientId) {
  return AndroidConfig.Strings.setStringItem(
    [
      {
        $: { name: WEB_CLIENT_ID_RESOURCE, translatable: 'false' },
        _: webClientId,
      },
    ],
    stringsXml
  );
}

/**
 * Pure transform: apply GIDClientID / GIDServerClientID and append the reversed
 * iOS-client URL scheme to a parsed Info.plist object. Idempotent — the scheme
 * is only appended when absent, and existing schemes (e.g. `wecooked`) are
 * preserved.
 */
function applyIosGoogleInfoPlist(infoPlist, { webClientId, iosClientId }) {
  infoPlist.GIDClientID = iosClientId;
  infoPlist.GIDServerClientID = webClientId;

  const scheme = reversedClientScheme(iosClientId);
  let next = infoPlist;
  if (!IOSConfig.Scheme.hasScheme(scheme, next)) {
    next = IOSConfig.Scheme.appendScheme(scheme, next);
  }
  return next;
}

function withAndroidWebClientId(config, webClientId) {
  return withStringsXml(config, (cfg) => {
    cfg.modResults = setWebClientIdStringResource(cfg.modResults, webClientId);
    return cfg;
  });
}

function withIosGoogleConfig(config, ids) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults = applyIosGoogleInfoPlist(cfg.modResults, ids);
    return cfg;
  });
}

const withWeCookedGoogleSignIn = (config, props = {}) => {
  const webClientId =
    typeof props.googleWebClientId === 'string' ? props.googleWebClientId.trim() : '';
  const iosClientId =
    typeof props.googleIosClientId === 'string' ? props.googleIosClientId.trim() : '';

  const haveWeb = webClientId.length > 0;
  const haveIos = iosClientId.length > 0;

  if (!haveWeb && !haveIos) {
    // Credential-free B4.2A: nothing to inject.
    return config;
  }
  if (haveWeb !== haveIos) {
    throw new Error(
      '[wecooked-google-signin] Incomplete configuration: both googleWebClientId ' +
        'and googleIosClientId are required, or neither.'
    );
  }

  let next = withAndroidWebClientId(config, webClientId);
  next = withIosGoogleConfig(next, { webClientId, iosClientId });
  return next;
};

module.exports = createRunOncePlugin(withWeCookedGoogleSignIn, 'wecooked-google-signin', '0.1.0');

// Exposed for automated tests (config-plugin unit tests never generate native
// project directories).
module.exports._internal = {
  WEB_CLIENT_ID_RESOURCE,
  reversedClientScheme,
  setWebClientIdStringResource,
  applyIosGoogleInfoPlist,
  withWeCookedGoogleSignIn,
};