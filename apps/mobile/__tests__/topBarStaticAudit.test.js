// TopBar — static source validation for the opt-in Saved/bookmark affordance.
//
// The teammate-authoritative Saved entry point (the only navigate('Saved')
// call anywhere in the teammate app, c1c86ed) is a bookmark icon in the
// Dashboard header. The bookmark is wired as an opt-in `onSavedPress` prop
// rather than a global addition, so only Dashboard passes it. These assertions
// lock that boundary. The mobile
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
const brandBranch = code.match(
  /mode\s*===\s*['"]brand['"]\s*\?\s*\(\s*(<>[\s\S]*?<\/>)\s*\)\s*:\s*\(/
);

const ingredientStudioNavigation =
  /navigation\s*\.\s*navigate\s*\(\s*['"]IngredientStudio['"]/;
const swapHorizontalIcon =
  /\bname\s*=\s*(?:['"]swap-horizontal['"]|\{\s*['"]swap-horizontal['"]\s*\})/;

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

  it('removes the persistent Substitute Finder from brand mode and shows authoritative unread state', () => {
    expect(brandBranch).not.toBeNull();
    const brandRegion = brandBranch?.[1] || '';

    // Fail closed: the scoped region is trusted only after proving extraction
    // reached the Notifications control at the end of the brand action area.
    expect(brandRegion).toMatch(/\bonPress\s*=\s*\{\s*pressBell\s*\}/);
    expect(brandRegion).toMatch(
      /\bname\s*=\s*(?:['"]notifications-outline['"]|\{\s*['"]notifications-outline['"]\s*\})/
    );

    expect(brandRegion).not.toMatch(ingredientStudioNavigation);
    expect(brandRegion).not.toMatch(swapHorizontalIcon);
    expect(brandRegion).toMatch(/\{onSavedPress && \(/);
    expect(brandRegion).toMatch(/name="bookmark-outline"/);
    expect(code).toMatch(/const \{ unreadCount \} = useNotifications\(\)/);
    expect(brandRegion).toMatch(/\{unreadCount > 0 && <View style=\{styles\.bellDot\} \/>/);
    expect(brandRegion).toMatch(/<NotificationsDropdown\s+visible=\{notifVisible\}/);
  });

  it('keeps the Notifications control accessible as a labelled button', () => {
    const notificationControl = code.match(
      /<Pressable\b(?=[^>]*onPress=\{pressBell\})[^>]*>/
    );
    expect(notificationControl).not.toBeNull();
    expect(notificationControl[0]).toMatch(/accessibilityRole\s*=\s*"button"/);
    expect(notificationControl[0]).toMatch(/accessibilityLabel=\{`Notifications, \$\{unreadCount\} unread`\}/);
  });

  it('holds no auth/session state or navigation reset of its own', () => {
    expect(code).not.toMatch(/useAuth\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/SecureStore|AsyncStorage|accessToken|refreshToken/);
  });
});

describe('other header contracts remain scoped to their screens', () => {
  it('product-authority screens keep their intended title/back controls', () => {
    const assistant = stripComments(read('screens/AssistantScreen.js'));
    const community = stripComments(read('screens/CommunityScreen.js'));
    const swaps = stripComments(read('screens/IngredientStudioScreen.js'));
    expect(assistant).toMatch(/navigation\.goBack\(\)/);
    expect(assistant).toMatch(/Ask the Chef/);
    expect(community).toMatch(/<TopBar mode="title" title="Community"/);
    expect(swaps).toMatch(/mode=\{asTab \? 'title' : 'back'\}/);
    expect(swaps).not.toMatch(/onSavedPress/);
  });

  it('title mode reserves the back-control space without drawing a back arrow', () => {
    expect(code).toMatch(/disabled=\{mode !== 'back' \|\| !onBack\}/);
    expect(code).toMatch(/\{mode === 'back' && <Ionicons name="arrow-back"/);
  });

  it('back mode exposes the existing back control as a labelled button', () => {
    const backControl = code.match(/<Pressable\b(?=[^>]*onPress=\{onBack\})[^>]*>/);
    expect(backControl).not.toBeNull();
    expect(backControl[0]).toMatch(
      /accessibilityRole\s*=\s*\{\s*mode\s*===\s*'back'\s*\?\s*'button'\s*:\s*undefined\s*\}/
    );
    expect(backControl[0]).toMatch(
      /accessibilityLabel\s*=\s*\{\s*mode\s*===\s*'back'\s*\?\s*'Back'\s*:\s*undefined\s*\}/
    );
  });

  it('Profile uses its teammate-local header and is no longer a TopBar consumer', () => {
    const profile = stripComments(read('screens/ProfileScreen.js'));
    expect(profile).not.toMatch(/import TopBar/);
    expect(profile).not.toMatch(/<TopBar\b/);
    expect(profile).toMatch(/name="settings-outline"/);
    expect(profile).toMatch(/name="notifications-outline"/);
  });
});
