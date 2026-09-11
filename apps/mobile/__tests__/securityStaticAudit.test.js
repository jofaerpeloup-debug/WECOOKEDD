// Security final-frontend port — static source validation.
//
// The teammate SecurityScreen (commit c1c86ed) is entirely fake: a "demo"
// disclaimer, a password form that never calls a backend, and a 2FA Switch
// persisted only to AsyncStorage. WeCooked security architecture wins over
// that implementation per the port brief. This screen instead:
//   - changes the real password via POST /auth/change-password
//     (authService.changePassword), then signs out for real (the backend
//     revokes every session on a successful change, so staying "logged in"
//     locally would be a lie);
//   - shows the real linked-Google-account state from user.authIdentities
//     and offers the real AuthContext.linkGoogle() — never an "Unlink"
//     action, because no unlink endpoint exists;
//   - offers the one real session-wide action that exists
//     (AuthContext.signOutEverywhere(), i.e. POST /auth/logout-all) since no
//     per-device session list endpoint exists;
//   - shows 2FA as a disabled, non-interactive Switch with an honest
//     "coming soon" label — never a working toggle with nothing behind it.
// Account deletion and biometric lock are absent from the teammate screen
// itself, so nothing is ported or fabricated for either. The mobile
// workspace has no RN renderer (see jest.config.js), so these invariants are
// encoded as source assertions.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const raw = read('screens/SecurityScreen.js');
const code = stripComments(raw);

describe('Security never fakes a credential or security action', () => {
  it('never claims a demo/no-real-password disclaimer — WeCooked passwords are real', () => {
    expect(code).not.toMatch(/demo/i);
    expect(code).not.toMatch(/doesn't check a real password/i);
  });

  it('never stores a password locally, in any form', () => {
    expect(code).not.toMatch(/AsyncStorage/);
    expect(code).not.toMatch(/loadJSON|saveJSON/);
    expect(code).not.toMatch(/wecooked:twoFactor/);
    expect(code).not.toMatch(/SecureStore/);
  });

  it('never exposes a refresh/access/id token, or any client secret', () => {
    expect(code).not.toMatch(/accessToken|refreshToken|idToken/);
    expect(code).not.toMatch(/clientId|CLIENT_ID|apiKey|API_KEY|secret|Bearer /i);
  });
});

describe('Change Password calls the real backend and handles its real outcome', () => {
  it('imports authService and calls the real change-password endpoint', () => {
    expect(raw).toMatch(/import \* as authService from '\.\.\/api\/authService'/);
    expect(code).toMatch(/await authService\.changePassword\(\{ currentPassword, newPassword \}\)/);
  });

  it('validates length and confirmation client-side before ever calling the backend', () => {
    expect(code).toMatch(/newPassword\.length < 8/);
    expect(code).toMatch(/newPassword !== confirmPassword/);
  });

  it('maps real backend failures through the shared error-message mapper, never a fabricated message', () => {
    expect(raw).toMatch(/import \{ getAuthErrorMessage \} from '\.\.\/api\/errorMessages'/);
    expect(code).toMatch(/setPwError\(getAuthErrorMessage\(err\)\)/);
  });

  it('signs out for real after a successful change — the backend already revoked every session', () => {
    expect(code).toMatch(/onPress: \(\) => signOut\(\)/);
  });

  it('never shows a fabricated success state without actually calling the backend', () => {
    // The old teammate/WeCooked "Security updated" fake-save message must be gone.
    expect(code).not.toMatch(/Security updated/);
    expect(code).not.toMatch(/Your (changes|preferences) have been saved/);
  });
});

describe('authService exposes the real authenticated change-password call', () => {
  const authService = fs.readFileSync(path.join(SRC, 'api/authService.js'), 'utf8');

  it('POSTs to /auth/change-password with currentPassword/newPassword only', () => {
    expect(authService).toMatch(/export function changePassword\(\{ currentPassword, newPassword \}\)/);
    expect(authService).toMatch(/api\.post\('\/auth\/change-password'/);
  });
});

describe('errorMessages maps the real change-password backend codes', () => {
  const errorMessages = fs.readFileSync(path.join(SRC, 'api/errorMessages.js'), 'utf8');

  it('maps AUTH_CURRENT_PASSWORD_INVALID and AUTH_PASSWORD_CHANGE_UNAVAILABLE to safe strings', () => {
    expect(errorMessages).toMatch(/case 'AUTH_CURRENT_PASSWORD_INVALID':/);
    expect(errorMessages).toMatch(/case 'AUTH_PASSWORD_CHANGE_UNAVAILABLE':/);
  });
});

describe('Linked Accounts reflects real server state, never a fake linked/unlinked toggle', () => {
  it('derives Google-linked status from the real user.authIdentities', () => {
    expect(code).toMatch(
      /const googleLinked = \(user\?\.authIdentities \|\| \[\]\)\.some\(\(identity\) => identity\.provider === 'google'\)/
    );
  });

  it('links via the real AuthContext.linkGoogle(), never a local-only toggle', () => {
    expect(raw).toMatch(/import \{ useAuth \} from '\.\.\/context\/AuthContext'/);
    expect(code).toMatch(/const \{ user, signOut, signOutEverywhere, linkGoogle \} = useAuth\(\)/);
    expect(code).toMatch(/await linkGoogle\(\)/);
  });

  it('never offers an Unlink action — no unlink endpoint exists', () => {
    expect(code).not.toMatch(/[Uu]nlink/);
  });

  it('checks native availability before attempting a link, honest when unavailable', () => {
    expect(raw).toMatch(/import \{ isAvailable as isGoogleAvailable \} from '\.\.\/auth\/googleAuthFlow'/);
    expect(code).toMatch(/const googleAvailable = isGoogleAvailable\(\)/);
    expect(code).toMatch(/GOOGLE_UNAVAILABLE/);
  });
});

describe('Sessions offers only the real, already-wired sign-out-everywhere action', () => {
  it('calls the real AuthContext.signOutEverywhere(), never a fabricated device list', () => {
    expect(code).toMatch(/onPress: \(\) => signOutEverywhere\(\)/);
  });

  it('never renders a fabricated list of devices/sessions', () => {
    expect(code).not.toMatch(/devices\.map\(/);
    expect(code).not.toMatch(/sessions\.map\(/);
    expect(code).not.toMatch(/deviceList/i);
  });
});

describe('Two-factor authentication is honestly unavailable, never a working fake toggle', () => {
  it('renders the Switch disabled and always false — no state, no persistence', () => {
    expect(code).toMatch(/<Switch\s+value=\{false\}\s+disabled/);
    expect(code).not.toMatch(/const \[twoFactor, setTwoFactor\]/);
    expect(code).not.toMatch(/setTwoFactor/);
  });

  it('labels 2FA as not yet available, not as a working control', () => {
    expect(code).toMatch(/Coming soon — not yet available for WeCooked accounts\./);
  });
});

describe('Account deletion and biometric lock are absent from the teammate screen and are not fabricated here', () => {
  it('never renders a delete-account or biometric-lock control the teammate screen does not have', () => {
    expect(code).not.toMatch(/[Dd]elete [Aa]ccount/);
    expect(code).not.toMatch(/deleteAccount/i);
    expect(code).not.toMatch(/[Bb]iometric/);
    expect(code).not.toMatch(/LocalAuthentication/);
  });
});

describe('Security navigation stays a plain stack destination', () => {
  it('goes back via navigation.goBack(), never resets/replaces into MainTabs', () => {
    expect(code).toMatch(/onBack=\{\(\) => navigation\.goBack\(\)\}/);
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/MainTabs/);
  });

  it('navigates nowhere else — this screen has no forward navigation targets', () => {
    const targets = [...code.matchAll(/navigation\.navigate\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]);
    expect(targets).toEqual([]);
  });
});

describe('the Security route registration is unchanged', () => {
  const nav = fs.readFileSync(path.join(SRC, 'navigation/RootNavigator.js'), 'utf8');

  it('RootNavigator still registers SecurityScreen at the "Security" route name', () => {
    expect(nav).toMatch(/<Stack\.Screen name="Security" component=\{SecurityScreen\} \/>/);
  });

  it('AccountDetailScreen still hands off to Security for the real change-password flow', () => {
    const accountDetail = fs.readFileSync(path.join(SRC, 'screens/AccountDetailScreen.js'), 'utf8');
    expect(accountDetail).toMatch(/onRightActionPress=\{\(\) => navigation\.navigate\('Security'\)\}/);
  });
});
