// M2 — static source validation of the ported teammate navigation shell.
//
// Verified against teammate WECOOKEDD @ c1c86ed (frozen authority; remote HEAD
// is byte-identical). Target shell:
//
//     Home | Community | (+) | Swaps | Profile
//
// where the centre "+" is a raised action button in <TabBar> that opens
// <PlusMenu> — NOT a Tab.Screen / navigation route.
//
// The mobile workspace has no RN renderer (see jest.config.js), so the
// invariants are encoded as source assertions. "Forbidden" checks run against a
// comment-stripped copy so a phrase in an explanatory comment does not trip
// them; "must contain" checks run against the raw source.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const mainTabsRaw = read('navigation/MainTabs.js');
const mainTabs = stripComments(mainTabsRaw);
const rootNavRaw = read('navigation/RootNavigator.js');
const rootNav = stripComments(rootNavRaw);
const tabBarRaw = read('components/TabBar.js');
const tabBar = stripComments(tabBarRaw);
const plusMenuRaw = read('components/PlusMenu.js');
const plusMenu = stripComments(plusMenuRaw);
const mealPlanRaw = read('screens/MealPlanScreen.js');
const mealPlan = stripComments(mealPlanRaw);

const tabScreenNames = (src) =>
  [...src.matchAll(/<Tab\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);
const stackScreenNames = (src) =>
  [...src.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);
const stack = stackScreenNames(rootNav);

describe('MainTabs — the verified teammate 4-tab set, in order', () => {
  it('registers exactly Home, Community, Swaps, Profile as Tab.Screens', () => {
    expect(tabScreenNames(mainTabs)).toEqual(['Home', 'Community', 'Swaps', 'Profile']);
  });

  it('maps each tab to the teammate-verified component', () => {
    expect(mainTabs).toMatch(/name="Home"\s+component=\{DashboardScreen\}/);
    expect(mainTabs).toMatch(/name="Community"\s+component=\{CommunityScreen\}/);
    expect(mainTabs).toMatch(/name="Swaps"\s+component=\{IngredientStudioScreen\}/);
    expect(mainTabs).toMatch(/name="Profile"\s+component=\{ProfileScreen\}/);
  });

  it('does NOT register the centre "+" / Assistant / MealPlan / Discover / Saved as tabs', () => {
    const names = tabScreenNames(mainTabs);
    for (const forbidden of ['Assistant', 'MealPlan', 'Plus', 'Add', 'Discover', 'Saved']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('drives the bar through the custom <TabBar>', () => {
    expect(mainTabs).toMatch(/tabBar=\{\(props\) => <TabBar \{\.\.\.props\} \/>\}/);
  });
});

describe('TabBar — raised centre action, not a route', () => {
  // The four TABS entries in order. `name` (not `key`) so it reads as, and is
  // asserted against, a REGISTERED route name.
  const tabNames = [...tabBar.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);

  it('lists only the four real tabs in its TABS array, in order', () => {
    expect(tabNames).toEqual(['Home', 'Community', 'Swaps', 'Profile']);
  });

  it('renders the centre "+" as a Pressable that opens PlusMenu via local state', () => {
    expect(tabBar).toMatch(/import PlusMenu from '\.\/PlusMenu'/);
    expect(tabBar).toMatch(/const \[menuOpen, setMenuOpen\] = useState\(false\)/);
    expect(tabBar).toMatch(/onPress=\{\(\) => setMenuOpen\(true\)\}/);
    expect(tabBar).toMatch(/<MaterialCommunityIcons name="chef-hat"/);
    expect(tabBar).toMatch(/<PlusMenu\s+visible=\{menuOpen\}/);
  });

  it('never navigates to a "+"/Assistant/MealPlan route from the centre button', () => {
    // The only navigate() in TabBar is the per-tab press.
    const targets = [...tabBar.matchAll(/navigation\.navigate\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(targets).toEqual(['tab.name']);
  });

  it('tab press targets a REGISTERED route name, never a route-instance key', () => {
    // `tab` is an element of the local TABS array (literal strings), NOT a
    // React Navigation `state.routes[]` object — so navigate(tab.name) targets
    // the registered route name. Guard against a future rewrite that reads the
    // route object and passes its `.key`.
    expect(tabBar).toMatch(/onPress=\{\(\) => navigation\.navigate\(tab\.name\)\}/);
    expect(tabBar).not.toMatch(/state\.routes\b/);
    expect(tabBar).not.toMatch(/\broute\.key\b/);
    expect(tabBar).not.toMatch(/navigation\.navigate\(\s*route\.key/);
    // Active state also comes from registered names, not a route object.
    expect(tabBar).toMatch(/state\.routeNames\[state\.index\]/);
  });

  it('every TabBar tab name is a real <Tab.Screen> in MainTabs (and vice-versa)', () => {
    expect(tabNames.slice().sort()).toEqual(tabScreenNames(mainTabs).slice().sort());
  });
});

describe('PlusMenu — teammate presentation + both verified actions', () => {
  it('is a transparent slide Modal with backdrop + Android back close', () => {
    expect(plusMenu).toMatch(/<Modal visible=\{visible\} transparent animationType="slide" onRequestClose=\{onClose\}/);
    expect(plusMenu).toMatch(/<Pressable style=\{styles\.backdrop\} onPress=\{onClose\} \/>/);
    expect(plusMenu).toMatch(/backgroundColor:\s*colors\.overlay/);
  });

  it('keeps both teammate rows: Ask the Chef -> Assistant, Meal Plan -> MealPlan', () => {
    const routes = [...plusMenu.matchAll(/route:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(routes).toEqual(['Assistant', 'MealPlan']);
    expect(plusMenu).toMatch(/title:\s*'Ask the Chef'/);
    expect(plusMenu).toMatch(/title:\s*'Meal Plan'/);
    expect(plusMenu).toMatch(/navigation\.navigate\(route\)/);
    expect(plusMenu).toMatch(/onClose\(\);\s*\n\s*navigation\.navigate\(route\)/);
  });

  it('every PlusMenu destination is a real registered root-stack route', () => {
    const routes = [...plusMenu.matchAll(/route:\s*'([^']+)'/g)].map((m) => m[1]);
    const registered = stackScreenNames(rootNav);
    for (const r of routes) expect(registered).toContain(r);
  });
});

describe('RootNavigator — non-tab destinations stay registered & reachable', () => {
  it('contains only the intended authenticated and guest stack routes', () => {
    expect(stack).toEqual([
      'MainTabs',
      'Discover',
      'Trending',
      'Saved',
      'CollectionDetail',
      'Assistant',
      'MealPlan',
      'IngredientStudio',
      'SwapDetail',
      'RecipeDetail',
      'RecipeReviews',
      'CookingHistory',
      'CookMode',
      'List',
      'AccountDetails',
      'Settings',
      'Security',
      'Notifications',
      'HelpCenter',
      'About',
      'Terms',
      'Privacy',
      'Licenses',
      // Deep-link-only routes, present in BOTH stacks — see below.
      'ResetPassword',
      'VerifyEmail',
      'VerifyEmailChange',
      'Landing',
      'Login',
      'Register',
      'ResetPassword',
      'VerifyEmail',
      'VerifyEmailChange',
    ]);
  });

  it.each(['MainTabs', 'Discover', 'Trending', 'Saved', 'Assistant', 'MealPlan', 'List', 'IngredientStudio', 'SwapDetail', 'RecipeDetail', 'RecipeReviews', 'CookingHistory', 'CookMode', 'AccountDetails', 'Settings'])(
    'registers the "%s" stack route',
    (name) => {
      expect(stack).toContain(name);
    }
  );

  it('maps the moved-off-tab routes to their real screens', () => {
    expect(rootNav).toMatch(/name="Discover"\s+component=\{DiscoverScreen\}/);
    expect(rootNav).toMatch(/name="Trending"\s+component=\{TrendingScreen\}/);
    expect(rootNav).toMatch(/name="Saved"\s+component=\{SavedScreen\}/);
    expect(rootNav).toMatch(/name="Assistant"\s+component=\{AssistantScreen\}/);
    expect(rootNav).toMatch(/name="MealPlan"\s+component=\{MealPlanScreen\}/);
    expect(rootNav).toMatch(/name="List"\s+component=\{ShoppingListScreen\}/);
    expect(rootNav).toMatch(/name="IngredientStudio"\s+component=\{IngredientStudioScreen\}/);
    expect(rootNav).toMatch(/name="SwapDetail"\s+component=\{SwapDetailScreen\}/);
    expect(rootNav).toMatch(/name="RecipeReviews"\s+component=\{RecipeReviewsScreen\}/);
    expect(rootNav).toMatch(/name="CookingHistory"\s+component=\{CookingHistoryScreen\}/);
  });

  it('registers RecipeReviews and CookingHistory exactly once in the authenticated root stack, never as tabs', () => {
    expect(stack.filter((name) => name === 'RecipeReviews')).toHaveLength(1);
    expect(stack.filter((name) => name === 'CookingHistory')).toHaveLength(1);
    expect(tabScreenNames(mainTabs)).not.toContain('RecipeReviews');
    expect(tabScreenNames(mainTabs)).not.toContain('CookingHistory');
    expect(rootNav).toMatch(/import RecipeReviewsScreen from '\.\.\/screens\/RecipeReviewsScreen'/);
    expect(rootNav).toMatch(/import CookingHistoryScreen from '\.\.\/screens\/CookingHistoryScreen'/);
  });
});

describe('auth deep-link routes are reachable regardless of auth state', () => {
  it('registers all three auth deep-link routes in the authenticated and unauthenticated stacks', () => {
    const counts = {};
    for (const name of stack) counts[name] = (counts[name] || 0) + 1;
    expect(counts.ResetPassword).toBe(2);
    expect(counts.VerifyEmail).toBe(2);
    expect(counts.VerifyEmailChange).toBe(2);
  });

  it('maps all three auth deep-link routes to their real screens', () => {
    expect(rootNav).toMatch(/name="ResetPassword"\s+component=\{ResetPasswordScreen\}/);
    expect(rootNav).toMatch(/name="VerifyEmail"\s+component=\{VerifyEmailScreen\}/);
    expect(rootNav).toMatch(/name="VerifyEmailChange"\s+component=\{VerifyEmailChangeScreen\}/);
  });

  it('NavigationContainer carries a linking config for exactly these auth routes, on the wecooked:// scheme', () => {
    expect(rootNavRaw).toMatch(/<NavigationContainer\s+ref=\{navigationRef\}\s+theme=\{navTheme\}\s+linking=\{linking\}>/);
    const linkingBlock = rootNavRaw.match(/const linking = \{[\s\S]*?\n\};/);
    expect(linkingBlock).not.toBeNull();
    expect(linkingBlock[0]).toMatch(/prefixes:\s*\['wecooked:\/\/'\]/);
    expect(linkingBlock[0]).toMatch(/ResetPassword:\s*'reset-password'/);
    expect(linkingBlock[0]).toMatch(/VerifyEmail:\s*'verify-email'/);
    expect(linkingBlock[0]).toMatch(/VerifyEmailChange:\s*'verify-email-change'/);
  });

  it('adds no catch-all/wildcard linking route', () => {
    const linkingBlock = rootNavRaw.match(/const linking = \{[\s\S]*?\n\};/)[0];
    expect(linkingBlock).not.toMatch(/\*/);
    expect(linkingBlock).not.toMatch(/NotFound/);
  });
});

describe('no nested duplicate route names (React Navigation same-name warning)', () => {
  it('MainTabs and the authenticated root stack share NO route name', () => {
    const tabs = tabScreenNames(mainTabs);
    const stackNames = stackScreenNames(rootNav);
    const intersection = tabs.filter((n) => stackNames.includes(n));
    expect(intersection).toEqual([]);
  });

  it('"Community" and "Profile" are MainTabs routes ONLY', () => {
    const tabs = tabScreenNames(mainTabs);
    const stackNames = stackScreenNames(rootNav);
    for (const name of ['Community', 'Profile']) {
      expect(tabs).toContain(name);
      expect(stackNames).not.toContain(name);
    }
    // Their components are imported by MainTabs, not RootNavigator (checked
    // against comment-stripped source so an explanatory comment can't trip it).
    expect(rootNav).not.toMatch(/CommunityScreen/);
    expect(rootNav).not.toMatch(/ProfileScreen/);
  });

  it('nothing navigates to a root-stack "Profile" (tab is the only entry point)', () => {
    const files = ['screens', 'components', 'navigation'].flatMap((d) =>
      fs.readdirSync(path.join(SRC, d))
        .filter((f) => f.endsWith('.js') && f !== 'NotificationsDropdown.js')
        .map((f) => fs.readFileSync(path.join(SRC, d, f), 'utf8'))
    );
    for (const src of files) {
      expect(stripComments(src)).not.toMatch(
        /(navigate|push|replace)\(\s*['"]Profile['"]|screen:\s*['"]Profile['"]/
      );
    }
  });

  it('Community is reached through the tab bar, including the existing notification deep action', () => {
    // Profile Settings final port (feat/frontend-migration-profile-settings)
    // dropped ProfileScreen's old flat "Community" menu row: the teammate
    // final Profile has no such row, and Community is already a sibling
    // MainTabs tab, so a direct row would only duplicate the tab bar. Nothing
    // needs to call navigate('Community') for the tab to be reachable — a tab
    // press IS the navigation.
    const tabBar = read('components/TabBar.js');
    expect(tabBar).toMatch(/name:\s*'Community'/);
    expect(tabScreenNames(mainTabs)).toContain('Community');
    const notifications = read('components/NotificationsDropdown.js');
    expect(notifications).toMatch(/import \{ actionDestination \} from '\.\.\/navigation\/notificationAction'/);
    expect(notifications).toMatch(/const destination = actionDestination\(notification\.action\)/);
    expect(notifications).toMatch(/navigation\.navigate\(\.\.\.destination\)/);

    // No screen introduces another direct Community route. The established
    // notification action above targets the registered tab through MainTabs.
    const files = ['screens', 'components', 'navigation'].flatMap((d) =>
      fs.readdirSync(path.join(SRC, d))
        .filter((f) => f.endsWith('.js') && f !== 'NotificationsDropdown.js')
        .map((f) => fs.readFileSync(path.join(SRC, d, f), 'utf8'))
    );
    const matches = files.flatMap((src) =>
      stripComments(src).match(/(navigate|push|replace)\(\s*['"]Community['"]|screen:\s*['"]Community['"]/g) || []
    );
    expect(matches).toEqual(["screen: 'Community'"]);
    expect(read('navigation/notificationAction.js')).toMatch(
      /return \['MainTabs', \{ screen: 'Community', params: \{ postId: action\.postId \} \}]/
    );
  });
});

describe('RootNavigator — auth architecture untouched', () => {
  it('keeps the single AuthContext-gated stack swap, no imperative auth nav', () => {
    expect(rootNav).toMatch(/const \{ isLoggedIn \} = useAuth\(\)/);
    expect(rootNav).toMatch(/\{isLoggedIn \? \(/);
    expect((rootNavRaw.match(/<NavigationContainer/g) || []).length).toBe(1);
  });

  it('adds no AsyncStorage / fake-login / replace|reset MainTabs logic', () => {
    for (const src of [rootNav, mainTabs, tabBar, plusMenu, mealPlan]) {
      expect(src).not.toMatch(/AsyncStorage/);
      expect(src).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
      expect(src).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
      expect(src).not.toMatch(/setIsLoggedIn|markLoggedIn|fakeLogin|demoLogin/);
    }
    // No second NavigationContainer anywhere in the shell files.
    for (const src of [mainTabsRaw, tabBarRaw, plusMenuRaw, mealPlanRaw]) {
      expect(src).not.toMatch(/NavigationContainer/);
    }
  });
});

describe('shell files carry no mock data or secrets', () => {
  it('import no mockData / mock providers / fixtures', () => {
    for (const src of [mainTabs, tabBar, plusMenu, mealPlan, rootNav]) {
      expect(src).not.toMatch(/data\/mockData/);
      expect(src).not.toMatch(/\bmockData\b/);
      expect(src).not.toMatch(/mocks\/|fixtures\//);
    }
  });

  it('carry no client/provider secrets or token material', () => {
    for (const src of [mainTabs, tabBar, plusMenu, mealPlan, rootNav]) {
      expect(src).not.toMatch(/clientId|CLIENT_ID|apiKey|API_KEY|secret|Bearer /i);
    }
  });
});

describe('MealPlan real M7 destination', () => {
  it('renders the real screen so the route resolves', () => {
    expect(mealPlanRaw).toMatch(/export default function MealPlanScreen/);
    expect(mealPlan).toMatch(/<Text style=\{styles\.title\}>Meal Plan<\/Text>/);
  });

  it('uses real services and no local/mock persistence', () => {
    expect(mealPlan).toMatch(/getMealPlan|removeMealPlanEntry|clearMealPlanRange/);
    expect(mealPlan).toMatch(/MealPlanSheet/);
    expect(mealPlan).toMatch(/useShoppingList/);
    expect(mealPlan).not.toMatch(/AsyncStorage|SecureStore/);
    expect(mealPlan).not.toMatch(/mockData|MealPlanContext|useMealPlan/);
  });

  it('preserves the day presentation and approved week navigation', () => {
    expect(mealPlan).toMatch(/weekDays\(weekAnchor\)/);
    expect(mealPlan).toMatch(/Previous week/);
    expect(mealPlan).toMatch(/Next week/);
  });
});

describe('Dashboard -> Discover initialFilter contract is preserved', () => {
  const dash = stripComments(read('screens/DashboardScreen.js'));
  it('Dashboard still navigates to the "Discover" route with initialFilter', () => {
    expect(dash).toMatch(/navigation\.navigate\('Discover',\s*\{\s*initialFilter/);
  });
  it('"Discover" is reachable (registered in the root stack)', () => {
    expect(stackScreenNames(rootNav)).toContain('Discover');
  });
});
