// TopBar — static source validation for the opt-in Saved/bookmark affordance.
//
// The teammate-authoritative Saved entry point (the only navigate('Saved')
// call anywhere in the teammate app, c1c86ed) is a bookmark icon in the
// Dashboard header. TopBar is shared by four `mode="brand"` screens
// (Dashboard/Assistant/IngredientStudio/Discover), so the bookmark is
// wired as an opt-in `onSavedPress` prop rather than a global addition — only
// Dashboard passes it. These assertions lock that boundary. The mobile
// workspace has no RN renderer (see jest.config.js), so invariants are
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

const raw = read('components/TopBar.js');
const code = stripComments(raw);

describe('TopBar Saved/bookmark affordance is opt-in, not global', () => {
  it('accepts an onSavedPress prop, defaulting to nothing', () => {
    expect(code).toMatch(/onSavedPress,/);
  });

  it('renders the bookmark control only when onSavedPress is provided', () => {
    expect(code).toMatch(/\{onSavedPress && \(/);
    expect(code).toMatch(/name="bookmark-outline"/);
  });

  it('pressing the bookmark calls the caller-supplied handler, not a hardcoded navigate', () => {
    // TopBar itself must not hold a navigation dependency for this control —
    // the caller (Dashboard) owns the `navigate('Saved')` call.
    const bookmarkBlock = code.match(/\{onSavedPress && \([\s\S]*?<\/Pressable>\s*\)\}/);
    expect(bookmarkBlock).not.toBeNull();
    expect(bookmarkBlock[0]).toMatch(/onPress=\{onSavedPress\}/);
    expect(bookmarkBlock[0]).not.toMatch(/navigation\.navigate/);
  });

  it('the swap-shortcut and notification bell behavior are unchanged', () => {
    expect(code).toMatch(/navigation\.navigate\('IngredientStudio'\)/);
    expect(code).toMatch(/name="swap-horizontal"/);
    expect(code).toMatch(/onPress=\{pressBell\}/);
    expect(code).toMatch(/name="notifications-outline"/);
    expect(code).toMatch(/showBellDot && <View style=\{styles\.bellDot\} \/>/);
  });

  it('holds no auth/session state or navigation reset of its own', () => {
    expect(code).not.toMatch(/useAuth\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/SecureStore|AsyncStorage|accessToken|refreshToken/);
  });
});

describe('other mode="brand" TopBar callers do not opt in (unaffected by the Saved control)', () => {
  const OTHER_BRAND_CALLERS = [
    'screens/AssistantScreen.js',
    'screens/IngredientStudioScreen.js',
    'screens/DiscoverScreen.js',
  ];

  it.each(OTHER_BRAND_CALLERS)('%s renders TopBar without onSavedPress', (rel) => {
    const src = stripComments(read(rel));
    expect(src).toMatch(/<TopBar mode="brand"\s*\/>/);
    expect(src).not.toMatch(/onSavedPress/);
  });

  it('Profile uses its teammate-local header and is no longer a TopBar consumer', () => {
    const profile = stripComments(read('screens/ProfileScreen.js'));
    expect(profile).not.toMatch(/import TopBar/);
    expect(profile).not.toMatch(/<TopBar\b/);
    expect(profile).toMatch(/name="settings-outline"/);
    expect(profile).toMatch(/name="notifications-outline"/);
  });
});
