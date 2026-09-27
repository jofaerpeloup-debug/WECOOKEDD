const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const raw = fs.readFileSync(path.join(SRC, 'screens/SettingsScreen.js'), 'utf8');
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const securityCode = fs.readFileSync(path.join(SRC, 'screens/SecurityScreen.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const notificationsCode = fs.readFileSync(path.join(SRC, 'screens/NotificationsScreen.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

function region(start, end) {
  const from = code.indexOf(start);
  const to = code.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return code.slice(from, to);
}

function sourceRegion(source, start, end) {
  expect(source.split(start)).toHaveLength(2);
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('Settings appearance uses the real ThemeContext', () => {
  it('reads and writes the persisted theme mode without local duplicate state', () => {
    expect(code).toMatch(/const \{ colors, mode, setMode \} = useTheme\(\)/);
    const appearance = region('APPEARANCE_OPTIONS.map', '</View>');
    expect(appearance).toMatch(/const active = mode === opt\.id/);
    expect(appearance).toMatch(/onPress=\{\(\) => setMode\(opt\.id\)\}/);
    expect(appearance).toMatch(/accessibilityState=\{\{ selected: active \}\}/);
    expect(code).not.toMatch(/useState\([^)]*(light|dark|system)|AsyncStorage|loadJSON|saveJSON/);
  });

  it('retains all supported light, dark, and system choices', () => {
    const options = region('const APPEARANCE_OPTIONS', 'export default function SettingsScreen');
    expect(options).toMatch(/id: 'light'/);
    expect(options).toMatch(/id: 'dark'/);
    expect(options).toMatch(/id: 'system'/);
  });
});

describe('Settings rows map exactly to live destinations', () => {
  it('gives every visible configured row a route and an unconditional navigation handler', () => {
    const groups = region('const SETTINGS_GROUPS', 'const ROUTES');
    const routes = region('const ROUTES', 'const APPEARANCE_OPTIONS');
    const ids = [...groups.matchAll(/id: '([a-z]+)'/g)].map((match) => match[1]);
    expect(ids).toEqual(['personal', 'security', 'notifications', 'help', 'about', 'terms', 'privacy', 'licenses']);
    for (const id of ids) expect(routes).toMatch(new RegExp(`${id}: '[A-Za-z]+'`));
    expect(code).toMatch(/onPress=\{\(\) => navigation\.navigate\(ROUTES\[item\.id\]\)\}/);
    expect(code).not.toMatch(/if \(ROUTES\[item\.id\]\)/);
  });

  it('describes only behavior the destination screens actually support', () => {
    const groups = region('const SETTINGS_GROUPS', 'const ROUTES');
    expect(groups).toMatch(/Password, verification, sessions/);
    expect(groups).toMatch(/Account-wide on or off/);
    expect(groups).not.toMatch(/2FA|Push, email alerts|contact/);
  });

  it('backs the Security copy with real password, verification, and session handlers', () => {
    const groups = region('const SETTINGS_GROUPS', 'const ROUTES');
    const routes = region('const ROUTES', 'const APPEARANCE_OPTIONS');
    expect(groups).toMatch(/id: 'security'[\s\S]*?sub: 'Password, verification, sessions'/);
    expect(routes).toMatch(/security: 'Security'/);

    const password = sourceRegion(securityCode, 'const handleChangePassword = async () => {', 'const [resendState');
    expect(password).toMatch(/pwSavingRef\.current/);
    expect(password).toMatch(/authService\.changePassword\(\{ currentPassword, newPassword \}\)/);
    expect(securityCode).toMatch(/title="Change Password"[\s\S]*?onPress=\{handleChangePassword\}/);

    const verification = sourceRegion(securityCode, 'const handleResendVerification = async () => {', 'const googleLinked');
    expect(verification).toMatch(/resendState === 'sending' \|\| !user\?\.email/);
    expect(verification).toMatch(/authService\.resendVerification\(user\.email\)/);
    expect(securityCode).toMatch(/onPress=\{handleResendVerification\}/);

    const sessions = sourceRegion(securityCode, 'const handleSignOutEverywhere = () => {', 'return (');
    expect(sessions).toMatch(/Alert\.alert\([\s\S]*?Sign out of all devices/);
    expect(sessions).toMatch(/onPress: \(\) => signOutEverywhere\(\)/);
    expect(securityCode).toMatch(/onPress=\{handleSignOutEverywhere\}/);
  });

  it('backs Notifications copy with the real account boolean and pessimistic account mutation', () => {
    const groups = region('const SETTINGS_GROUPS', 'const ROUTES');
    const routes = region('const ROUTES', 'const APPEARANCE_OPTIONS');
    expect(groups).toMatch(/id: 'notifications'[\s\S]*?sub: 'Account-wide on or off'/);
    expect(routes).toMatch(/notifications: 'Notifications'/);

    expect(notificationsCode).toMatch(/const \{ user, syncUser \} = useAuth\(\)/);
    expect(notificationsCode).toMatch(/const enabled = !!user\?\.preferences\?\.notifications\?\.enabled/);
    expect(notificationsCode).not.toMatch(/\[enabled, setEnabled\] = useState/);
    const toggle = sourceRegion(notificationsCode, 'const toggle = async (next) => {', 'return (');
    expect(toggle).toMatch(/if \(savingRef\.current\) return/);
    expect(toggle).toMatch(/updateProfile\(\{[\s\S]*?preferences: \{ notifications: \{ enabled: next \} \}/);
    expect(toggle).toMatch(/syncUser\(updated\)/);
    const notificationSwitch = sourceRegion(notificationsCode, '<Switch', '/>');
    expect(notificationSwitch).toMatch(/value=\{enabled\}/);
    expect(notificationSwitch).toMatch(/onValueChange=\{toggle\}/);
    expect(notificationSwitch).toMatch(/disabled=\{saving\}/);
  });

  it('labels the heading and every generated navigation row', () => {
    expect(code).toMatch(/accessibilityRole="header">Settings/);
    expect(code).toMatch(/accessibilityRole="button"[\s\S]*?accessibilityLabel=\{item\.label\}/);
  });
});

describe('Settings logout preserves the real session path', () => {
  it('confirms and calls AuthContext signOut', () => {
    expect(raw).toMatch(/useAuth.*AuthContext/);
    expect(code).toMatch(/const \{ signOut \} = useAuth\(\)/);
    const logout = region('const handleLogout', 'return (');
    expect(logout).toMatch(/Alert\.alert\('Log Out'/);
    expect(logout).toMatch(/onPress: \(\) => signOut\(\)/);
  });

  it('does not reset navigation or manipulate tokens itself', () => {
    expect(code).not.toMatch(/navigation\.(reset|replace)\(|SecureStore|tokenStore|accessToken|refreshToken/);
  });

  it('exposes the logout button to accessibility', () => {
    expect(code).toMatch(/style=\{styles\.logoutBtn\}[\s\S]*?accessibilityRole="button"[\s\S]*?accessibilityLabel="Log out"/);
  });
});

describe('Settings omits unsupported teammate settings', () => {
  it('has no fake toggle, AI configuration, or granular preference surface', () => {
    expect(code).not.toMatch(/<Switch|AiSettings|useAi|apiKey|OpenAI|digest|reminder|biometric/i);
  });

  it('does not claim privacy controls, data export/deletion, language, or social integration', () => {
    expect(code).not.toMatch(/analytics consent|data export|delete account|language|localization|social integration/i);
  });

  it('keeps all referenced routes registered in RootNavigator', () => {
    const nav = fs.readFileSync(path.join(SRC, 'navigation/RootNavigator.js'), 'utf8');
    for (const route of ['AccountDetails', 'Security', 'Notifications', 'HelpCenter', 'About', 'Terms', 'Privacy', 'Licenses']) {
      expect(nav).toContain(`name="${route}"`);
    }
  });
});
