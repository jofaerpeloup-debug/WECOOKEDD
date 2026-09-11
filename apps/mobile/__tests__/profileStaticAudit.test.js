// Profile final-frontend port — static source validation.
//
// ProfileScreen.js follows the teammate screen's final visible structure
// (commit c1c86ed): local gear/Profile/bell header, identity block
// (avatar/name/email + "Edit profile"), a three-stat row, the complete
// Preferences list, and a logout row. It stays backed
// exclusively by real AuthContext user data and FavoritesContext — it never
// hardcodes the teammate's mock `chef` identity, never fabricates a
// Collections/Cooked count, and never persists anything locally. The mobile
// workspace has no RN renderer (see jest.config.js), so these invariants are
// encoded as source assertions.
//
// "Forbidden" checks run against a comment-stripped copy so a phrase that
// only appears in an explanatory comment does not trip them; "must contain"
// checks run against the raw source.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const raw = read('screens/ProfileScreen.js');
const code = stripComments(raw);

describe('Profile stays on the real backend-only data path', () => {
  it('reads identity from the real AuthContext user, not a mock profile', () => {
    expect(raw).toMatch(/import \{ useAuth \} from '\.\.\/context\/AuthContext'/);
    expect(code).toMatch(/const \{ user, signOut \} = useAuth\(\)/);
    expect(code).toMatch(/user\?\.name/);
    expect(code).toMatch(/user\?\.email/);
  });

  it('never imports mockData, ProfileContext, or any teammate mock profile source', () => {
    expect(code).not.toMatch(/data\/mockData/);
    expect(code).not.toMatch(/ProfileContext/);
    expect(code).not.toMatch(/useProfile\(/);
    expect(code).not.toMatch(/\bchef\b/);
  });

  it('never hardcodes a teammate display name, email, or bio string', () => {
    expect(code).not.toMatch(/Ninong/i);
    expect(code).not.toMatch(/pravatar\.cc/);
  });

  it('never introduces AsyncStorage or any local-only persistence', () => {
    expect(code).not.toMatch(/AsyncStorage/);
    expect(code).not.toMatch(/loadJSON|saveJSON/);
    expect(code).not.toMatch(/wecooked:profile|wecooked:profilePrefs/);
  });

  it('does not render cuisine or vibe metadata', () => {
    expect(code).not.toMatch(/cuisine/i);
    expect(code).not.toMatch(/\bvibe\b/i);
  });

  it('carries no client/provider secrets or token material', () => {
    expect(code).not.toMatch(/clientId|CLIENT_ID|apiKey|API_KEY|secret|Bearer /i);
  });
});

describe('Profile stats are honest, never fabricated', () => {
  it('draws the saved count from the real FavoritesContext', () => {
    expect(raw).toMatch(/import \{ useFavorites \} from '\.\.\/context\/FavoritesContext'/);
    expect(code).toMatch(/const \{ favoriteIds, isInitializing \} = useFavorites\(\)/);
    expect(code).toMatch(/favoriteIds\.size/);
  });

  it('never fabricates a Collections or Cooked count — both render the unavailable marker', () => {
    expect(code).not.toMatch(/COLLECTIONS\.length/);
    expect(code).not.toMatch(/collections\.length \+ /);
    expect(code).not.toMatch(/cookedCount/);
    const unavailableUses = code.match(/UNAVAILABLE_STAT/g) || [];
    // One definition + at least two render sites (Collections, Cooked).
    expect(unavailableUses.length).toBeGreaterThanOrEqual(3);
  });

  it('renders exactly three stats, matching the teammate stat row', () => {
    const statMatches = [...code.matchAll(/<Stat\b/g)];
    expect(statMatches.length).toBe(3);
  });
});

describe('Profile preferences preserve unsupported teammate controls honestly', () => {
  it('keeps Dietary Preference and Cooking Level visible', () => {
    expect(code).toMatch(/>Dietary Preference<\/Text>/);
    expect(code).toMatch(/>Cooking Level<\/Text>/);
  });

  it('reports both unsupported controls unavailable without inventing values or picker state', () => {
    expect(code).toMatch(/showUnavailable\('Dietary preference'\)/);
    expect(code).toMatch(/showUnavailable\('Cooking level'\)/);
    expect(code).toMatch(/\$\{feature\} is not available yet\./);
    expect(code).not.toMatch(/DIETARY_PREF_OPTIONS/);
    expect(code).not.toMatch(/COOKING_LEVELS/);
    expect(code).not.toMatch(/cycleLevel/);
    expect(code).not.toMatch(/setDietPref/);
    expect(code).not.toMatch(/setLevel/);
  });

  it('routes Allergies, Meal Plan, and Settings to existing real routes', () => {
    expect(code).toMatch(/navigation\.navigate\('AccountDetails'\)/);
    expect(code).toMatch(/navigation\.navigate\('MealPlan'\)/);
    expect(code).toMatch(/navigation\.navigate\('Settings'\)/);
  });

  it('summarizes real allergies from the authenticated user, not mock data', () => {
    expect(code).toMatch(/const allergies = user\?\.preferences\?\.allergies \|\| \[\]/);
    expect(code).toMatch(/allergies\.join\(', '\)/);
  });

  it('does not add a duplicate Community/Terms/Privacy/HelpCenter row — those are reachable via the tab bar or Settings', () => {
    expect(code).not.toMatch(/navigation\.navigate\('Community'\)/);
    expect(code).not.toMatch(/navigation\.navigate\('Terms'\)/);
    expect(code).not.toMatch(/navigation\.navigate\('Privacy'\)/);
    expect(code).not.toMatch(/navigation\.navigate\('HelpCenter'\)/);
  });
});

describe('Profile logout is the real AuthContext logout, never a fake local one', () => {
  it('calls the real signOut(), never a manual token/state mutation', () => {
    expect(code).toMatch(/onPress: \(\) => signOut\(\)/);
  });

  it('never resets or replaces navigation into MainTabs/Onboarding — AuthContext auth-gating does that', () => {
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/MainTabs/);
    expect(code).not.toMatch(/Onboarding/);
  });

  it('confirms before logging out', () => {
    expect(code).toMatch(/Alert\.alert\('Log Out'/);
  });
});

describe('Profile uses the teammate-local tab header', () => {
  it('does not import or render the shared brand TopBar', () => {
    expect(code).not.toMatch(/import TopBar/);
    expect(code).not.toMatch(/<TopBar\b/);
    expect(code).not.toMatch(/mode="brand"/);
  });

  it('renders gear, centered Profile title, and bell controls', () => {
    expect(code).toMatch(/name="settings-outline"/);
    expect(code).toMatch(/style=\{styles\.headerTitle\}>Profile<\/Text>/);
    expect(code).toMatch(/name="notifications-outline"/);
  });

  it('routes gear to Settings and bell to Notifications', () => {
    expect(code).toMatch(/accessibilityLabel="Settings"[\s\S]*?navigation\.navigate\('Settings'\)/);
    expect(code).toMatch(/accessibilityLabel="Notifications"[\s\S]*?navigation\.navigate\('Notifications'\)/);
  });
});

describe('the Profile route registration is unchanged', () => {
  const mainTabs = fs.readFileSync(path.join(SRC, 'navigation/MainTabs.js'), 'utf8');

  it('Profile stays a MainTabs tab, not a root-stack route', () => {
    expect(mainTabs).toMatch(/ProfileScreen/);
    const rootNav = fs.readFileSync(path.join(SRC, 'navigation/RootNavigator.js'), 'utf8');
    expect(rootNav).not.toMatch(/<Stack\.Screen name="Profile"/);
  });
});
