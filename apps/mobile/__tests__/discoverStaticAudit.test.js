// M2.2 — static source validation of the ported Discover ("Search") screen.
//
// M2.2 ports the teammate Discover *presentation* onto our real recipe API +
// routes. The mobile workspace has no RN renderer (see jest.config.js), so the
// invariants are encoded as source assertions: the mock-architecture shapes a
// UI-only pass could drag in, and the real wiring that must stay underneath.
//
// "Forbidden" checks run against a comment-stripped copy so a phrase that only
// appears in an explanatory comment does not trip them; "must contain" checks
// run against the raw source.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const raw = read('screens/DiscoverScreen.js');
const code = stripComments(raw);

describe('Discover keeps our real recipe data architecture (no mock regression)', () => {
  it('imports no mock-data layer or teammate mock providers', () => {
    expect(code).not.toMatch(/data\/mockData/);
    expect(code).not.toMatch(/\bmockData\b/);
    expect(code).not.toMatch(/mocks\/|fixtures\//);
    expect(code).not.toMatch(
      /useSavedRecipes|useCommunity|useSearchHistory|useSearchHistoryContext|useNotifications|useProfile/
    );
    expect(code).not.toMatch(/\bTIME_BUCKETS\b|\bDIETARIES\b|\bSPICE_LEVELS\b/);
  });

  it('fetches recipes from the real REST service', () => {
    expect(raw).toMatch(/import \{ listRecipes \} from '\.\.\/api\/recipeService'/);
    expect(code).toMatch(/listRecipes\(queryFor\(1\)\)/);
    expect(code).toMatch(/listRecipes\(queryFor\(nextPage\)\)/);
    expect(raw).toMatch(/getRecipeErrorMessage/);
  });

  it('never fakes loading or hard-codes a recipe list', () => {
    expect(code).not.toMatch(/setTimeout\([^,]*,\s*\d{3,}\s*\)/); // no fake latency
    expect(code).not.toMatch(/const\s+(recipes|RECIPES|RESULTS|MOCK)\s*=\s*\[/);
  });

  it('keeps the generation-guarded first-page / load-more / refresh pipeline', () => {
    expect(code).toMatch(/genRef/);
    expect(code).toMatch(/gen !== genRef\.current/);
    expect(code).toMatch(/loadFirstPage/);
    expect(code).toMatch(/loadMore/);
    expect(code).toMatch(/totalPages/);
    expect(code).toMatch(/RefreshControl/);
  });

  it('wires the search box to the real backend `search` param (debounced)', () => {
    expect(code).toMatch(/debouncedSearch/);
    expect(code).toMatch(/SEARCH_DEBOUNCE_MS/);
    expect(code).toMatch(/search: debouncedSearch/);
    expect(code).toMatch(/\.trim\(\)/);
    // Not the teammate client-side scan over a mock array.
    expect(code).not.toMatch(/recipes\.filter\(/);
    expect(code).not.toMatch(/\.ingredients\.some\(/);
  });

  it('keeps the real Favorites + image components on recipe cards', () => {
    expect(raw).toMatch(/import FavoriteHeart from '\.\.\/components\/FavoriteHeart'/);
    expect(raw).toMatch(/import RecipeImage from '\.\.\/components\/RecipeImage'/);
    expect(code).toMatch(/<FavoriteHeart\b/);
    expect(code).toMatch(/<RecipeImage\b/);
  });

  it('renders recipe photography from the backend imageUrl only', () => {
    expect(code).toMatch(/source=\{item\.imageUrl\}/);
    expect(code).not.toMatch(/https?:\/\//);
    expect(code).not.toMatch(/unsplash|picsum|pravatar|gmanews/i);
    expect(code).not.toMatch(/\{\s*uri:\s*require\(/);
    expect(code).not.toMatch(/\brequire\(/);
  });

  it('carries no client/provider secrets or token material', () => {
    expect(code).not.toMatch(/clientId|CLIENT_ID|apiKey|API_KEY|secret|Bearer /i);
  });
});

describe('Discover does not cross the navigation / auth boundary', () => {
  it('never replaces or resets into MainTabs', () => {
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/MainTabs/);
  });

  it('navigates only to RecipeDetail, with our API param shape', () => {
    const targets = [...code.matchAll(/navigation\.navigate\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(t).toBe('RecipeDetail');
    expect(code).toMatch(/navigation\.navigate\('RecipeDetail',\s*\{/);
    expect(code).toMatch(/recipeSource: 'api'/);
    expect(code).toMatch(/recipeId: recipe\.id/);
    expect(code).not.toMatch(/navigate\('RecipeDetail',\s*\{\s*recipe\s*\}/);
  });

  it('holds no authentication, session, or token state of its own', () => {
    expect(code).not.toMatch(/SecureStore|expo-secure-store|tokenStore/);
    expect(code).not.toMatch(/accessToken|refreshToken|idToken/);
    expect(code).not.toMatch(/setIsLoggedIn|markLoggedIn|fakeLogin|demoLogin/);
    expect(code).not.toMatch(/useAuth\(/);
    expect(code).not.toMatch(/AsyncStorage/);
  });
});

describe('the Dashboard -> Discover handoff contract holds (M2.1 locked)', () => {
  it('the four filter keys stay exactly all | easy | vegetarian | vegan', () => {
    const { DISCOVER_FILTERS } = require('../src/api/recipeOptions');
    // Every M2 key still resolves to a real entry in the shared source of truth.
    for (const key of ['all', 'easy', 'vegetarian', 'vegan']) {
      expect(DISCOVER_FILTERS.some((f) => f.key === key)).toBe(true);
    }
    // The screen pins the filter row to exactly those four keys.
    expect(code).toMatch(/M2_FILTER_KEYS = \['all', 'easy', 'vegetarian', 'vegan'\]/);
    expect(code).toMatch(/DISCOVER_FILTERS\.find\(\(f\) => f\.key === key\)/);
  });

  it('seeds activeKey from route.params.initialFilter on first mount', () => {
    expect(code).toMatch(/route\.params\?\.initialFilter/);
    expect(code).toMatch(/FILTER_BY_KEY\[k\]\s*\?\s*k\s*:\s*'all'/);
  });

  it('re-consumes initialFilter on the already-mounted tab, then clears the param', () => {
    expect(code).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?route\.params\?\.initialFilter[\s\S]*?setActiveKey\(key\)[\s\S]*?navigation\.setParams\(\{ initialFilter: undefined \}\)[\s\S]*?\}, \[route\.params\?\.initialFilter, navigation\]\)/
    );
  });
});

describe('no new cuisine / category / region UX (locked M2 decision)', () => {
  it('adds no cuisine filter, chip, label, copy or query', () => {
    expect(code).not.toMatch(/cuisine/i);
    expect(code).not.toMatch(/\bFilipino\b|\bLuzon\b|\bVisayas\b|\bMindanao\b|\bregion\b/);
    expect(code).not.toMatch(/\bcategory\b/);
    expect(code).not.toMatch(/craving/i);
  });
});
