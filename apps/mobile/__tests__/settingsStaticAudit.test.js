// Settings final-frontend port — static source validation.
//
// SettingsScreen.js already matched the teammate screen's final visible
// structure (commit c1c86ed) before this slice: a real Appearance segmented
// control wired to ThemeContext and navigation cards. The final Account /
// Preferences / Support / Legal menu now lives beside its production consumer
// in SettingsScreen rather than in mockData. Every row on this screen either
// navigates to a real destination or drives a real, already-persisted app
// setting — there are no inline fake toggles on this screen at all (Security
// owns the one unsupported toggle, 2FA). The mobile workspace has no RN
// renderer (see jest.config.js), so these invariants are encoded as source
// assertions.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const raw = read('screens/SettingsScreen.js');
const code = stripComments(raw);

describe('Settings appearance control drives the real ThemeContext', () => {
  it('reads/writes mode through useTheme(), never local-only state', () => {
    expect(code).toMatch(/const \{ colors, mode, setMode \} = useTheme\(\)/);
    expect(code).toMatch(/onPress=\{\(\) => setMode\(opt\.id\)\}/);
  });

  it('never introduces AsyncStorage or a duplicate persistence key for appearance', () => {
    expect(code).not.toMatch(/AsyncStorage/);
    expect(code).not.toMatch(/loadJSON|saveJSON/);
  });
});

describe('Settings groups match the teammate final grouping exactly', () => {
  it('owns production menu config locally and has no mockData dependency', () => {
    expect(code).toMatch(/const SETTINGS_GROUPS = \[/);
    expect(code).toMatch(/SETTINGS_GROUPS\.map\(\(group\)/);
    expect(code).not.toMatch(/data\/mockData/);
    expect(code).not.toMatch(/import \{ settingsGroups \}/);
  });

  it('routes every settingsGroups id the teammate supports, including the Legal group', () => {
    expect(code).toMatch(/personal: 'AccountDetails'/);
    expect(code).toMatch(/security: 'Security'/);
    expect(code).toMatch(/notifications: 'Notifications'/);
    expect(code).toMatch(/help: 'HelpCenter'/);
    expect(code).toMatch(/about: 'About'/);
    expect(code).toMatch(/terms: 'Terms'/);
    expect(code).toMatch(/privacy: 'Privacy'/);
    expect(code).toMatch(/licenses: 'Licenses'/);
  });

  it('drops the WeCooked-only fabricated "dietary" quick-route — real editing lives in AccountDetails', () => {
    expect(code).not.toMatch(/dietary: 'AccountDetails'/);
  });

  it('local menu has no id without a route and never silently no-ops', () => {
    const settingsBlock = code.slice(code.indexOf('const SETTINGS_GROUPS'), code.indexOf('const ROUTES'));
    const ids = [...settingsBlock.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    const routesBlock = code.slice(code.indexOf('const ROUTES'), code.indexOf('const APPEARANCE_OPTIONS'));
    for (const id of ids) {
      expect(routesBlock).toMatch(new RegExp(`${id}: '`));
    }
    expect(code).toMatch(/onPress=\{\(\) => navigation\.navigate\(ROUTES\[item\.id\]\)\}/);
    expect(code).not.toMatch(/if \(ROUTES\[item\.id\]\)/);
  });

  it('preserves Account, Preferences, Support, and Legal in teammate order', () => {
    const block = code.slice(code.indexOf('const SETTINGS_GROUPS'), code.indexOf('const ROUTES'));
    const titles = [...block.matchAll(/title: '([^']+)'/g)].map((match) => match[1]);
    expect(titles).toEqual(['Account', 'Preferences', 'Support', 'Legal']);
    expect(block).toMatch(/id: 'terms'/);
    expect(block).toMatch(/id: 'privacy'/);
    expect(block).toMatch(/id: 'licenses'/);
  });
});

describe('Settings logout is the real AuthContext logout', () => {
  it('calls the real signOut(), never a manual token/state mutation', () => {
    expect(raw).toMatch(/import \{ useAuth \} from '\.\.\/context\/AuthContext'/);
    expect(code).toMatch(/const \{ signOut \} = useAuth\(\)/);
    expect(code).toMatch(/onPress: \(\) => signOut\(\)/);
  });

  it('never resets or replaces navigation into MainTabs — AuthContext auth-gating does that', () => {
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/MainTabs/);
  });
});

describe('the Settings route registration is unchanged', () => {
  const nav = fs.readFileSync(path.join(SRC, 'navigation/RootNavigator.js'), 'utf8');

  it('RootNavigator still registers SettingsScreen at the "Settings" route name, and Terms/Privacy/Licenses all exist', () => {
    expect(nav).toMatch(/<Stack\.Screen name="Settings" component=\{SettingsScreen\} \/>/);
    expect(nav).toMatch(/<Stack\.Screen name="Terms" component=\{TermsScreen\} \/>/);
    expect(nav).toMatch(/<Stack\.Screen name="Privacy" component=\{PrivacyScreen\} \/>/);
    expect(nav).toMatch(/<Stack\.Screen name="Licenses" component=\{LicensesScreen\} \/>/);
  });
});
