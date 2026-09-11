// Account Details final-frontend port — static source validation.
//
// AccountDetailScreen.js (route name "AccountDetails") was already real
// before this slice — it edits `name`/`preferences.dietaryPreferences`/
// `preferences.allergies` via the real PATCH /users/me mutation. This port
// keeps the teammate avatar-edit affordance and Bio field visible, but makes
// their unsupported state explicit. It also adds the masked, non-editable
// Password row that hands off to the real Security screen and verifies the
// screen never exposes role/status/id mutation or local persistence. The mobile
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

const raw = read('screens/AccountDetailScreen.js');
const code = stripComments(raw);

describe('Account Details edits only real, backend-supported fields', () => {
  it('seeds from the real AuthContext user, not mock data', () => {
    expect(raw).toMatch(/import \{ useAuth \} from '\.\.\/context\/AuthContext'/);
    expect(code).toMatch(/const \{ user, syncUser \} = useAuth\(\)/);
  });

  it('saves name/dietaryPreferences/allergies via the real profileService mutation', () => {
    expect(raw).toMatch(/import \{ updateProfile \} from '\.\.\/api\/profileService'/);
    expect(code).toMatch(/await updateProfile\(\{/);
    expect(code).toMatch(/dietaryPreferences: dietary/);
    expect(code).toMatch(/allergies,/);
    expect(code).toMatch(/syncUser\(updated\)/);
  });

  it('never sends bio, avatar, role, status, id, or notifications', () => {
    const saveCallBody = code.match(/const updated = await updateProfile\(\{([\s\S]*?)\}\);/);
    expect(saveCallBody).not.toBeNull();
    expect(saveCallBody[1]).not.toMatch(/\bbio\b|\bavatar\b|\brole\b|\bstatus\b|\bid\b|passwordHash|notifications/);
  });

  it('never imports mockData or a teammate mock profile context', () => {
    expect(code).not.toMatch(/data\/mockData/);
    expect(code).not.toMatch(/ProfileContext/);
    expect(code).not.toMatch(/useProfile\(/);
    expect(code).not.toMatch(/\bchef\b/);
  });

  it('never introduces AsyncStorage or any local-only persistence', () => {
    expect(code).not.toMatch(/AsyncStorage/);
    expect(code).not.toMatch(/loadJSON|saveJSON/);
  });
});

describe('Unsupported fields stay honestly read-only, never faked', () => {
  it('email is presented read-only with an honest caption, never an editable Input', () => {
    expect(code).toMatch(/Email changes aren't available yet\./);
    expect(code).toMatch(/styles\.readonlyValue/);
  });

  it('shows an initials avatar with teammate camera affordance and honest unavailable action', () => {
    expect(code).toMatch(/const initial = \(trimmedName \|\| user\?\.name \|\| 'A'\)/);
    expect(code).toMatch(/accessibilityLabel="Change avatar"/);
    expect(code).toMatch(/name="camera"/);
    expect(code).toMatch(/Changing your avatar is not available yet\./);
    expect(code).not.toMatch(/AVATAR_CHOICES/);
    expect(code).not.toMatch(/avatarOpen/);
    expect(code).not.toMatch(/pravatar\.cc/);
  });

  it('keeps Bio visible and explicitly read-only without local or request persistence', () => {
    expect(code).toMatch(/label="Bio"/);
    expect(code).toMatch(/placeholder="Bio isn't available yet"/);
    expect(code).toMatch(/Bio editing isn't available yet\./);
    expect(code).not.toMatch(/\[bio, setBio\]/);
  });

  it('renders the password row as a static masked placeholder, never the real value', () => {
    expect(code).toMatch(/value="••••••••••"/);
    expect(code).toMatch(/secureTextEntry/);
    expect(code).toMatch(/editable=\{false\}/);
    expect(code).not.toMatch(/passwordHash/);
    expect(code).not.toMatch(/user\?\.password/);
  });

  it('the password row hands off to the real Security screen, not a fake local change', () => {
    expect(code).toMatch(/rightAction="Change Password"/);
    expect(code).toMatch(/onRightActionPress=\{\(\) => navigation\.navigate\('Security'\)\}/);
  });
});

describe('Account Details navigation stays a plain stack destination', () => {
  it('goes back via navigation.goBack() on save and cancel, never resets/replaces', () => {
    expect(code).toMatch(/navigation\.goBack\(\)/);
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/MainTabs/);
  });
});

describe('the AccountDetails route registration is unchanged', () => {
  const nav = fs.readFileSync(path.join(SRC, 'navigation/RootNavigator.js'), 'utf8');

  it('RootNavigator still registers AccountDetailScreen at the "AccountDetails" route name', () => {
    expect(nav).toMatch(/import AccountDetailsScreen from '\.\.\/screens\/AccountDetailScreen'/);
    expect(nav).toMatch(/<Stack\.Screen name="AccountDetails" component=\{AccountDetailsScreen\} \/>/);
  });
});
