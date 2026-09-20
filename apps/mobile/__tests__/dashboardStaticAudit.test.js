// M2.1 — static source validation of the ported Dashboard/Home screen.
//
// M2.1 ports the teammate Dashboard *presentation* onto our real data + routes.
// Jest here renders nothing (the mobile workspace has no RN renderer — see
// jest.config.js), so the invariants are encoded as source assertions: the
// shapes a UI-only pass could plausibly drag in from the teammate's mock
// architecture, and the real wiring that must still be underneath.
//
// "Forbidden" checks run against a comment-stripped copy so a phrase that
// appears only in an explanatory comment does not trip them; "must contain"
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

function extractBalancedAfter(src, anchor, open, close) {
  const anchorIndex = src.indexOf(anchor);
  if (anchorIndex < 0) return null;
  if (src.indexOf(anchor, anchorIndex + anchor.length) >= 0) return null;
  const start = src.indexOf(open, anchorIndex + anchor.length);
  if (start < 0) return null;

  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = start; i < src.length; i += 1) {
    const char = src[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

function staticTextNodes(src) {
  return [...src.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)]
    .map((match) =>
      match[1]
        .replace(/\{\s*(['"])(.*?)\1\s*\}/g, '$2')
        .replace(/\{[\s\S]*?\}/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);
}

function hasVisibleLabelFamily(src, families) {
  const labels = staticTextNodes(src).map((label) => label.toLowerCase());
  return labels.some((label) => families.some((family) => label.startsWith(family)));
}

function hasCategoryQueryKey(src) {
  return /\bcategory\s*:/.test(src);
}

const raw = read('screens/DashboardScreen.js');
const code = stripComments(raw);

describe('static audit source helpers', () => {
  it('fails closed for missing, duplicate, and unbalanced anchors', () => {
    expect(extractBalancedAfter('const value = [1];', 'missing', '[', ']')).toBeNull();
    expect(extractBalancedAfter('anchor [1]; anchor [2];', 'anchor', '[', ']')).toBeNull();
    expect(extractBalancedAfter('anchor [1;', 'anchor', '[', ']')).toBeNull();
  });

  it('ignores delimiters inside ordinary quoted strings', () => {
    const block = extractBalancedAfter(
      "anchor ['single ]', \"double ]\", `template ]`, { key: 'value' }]",
      'anchor',
      '[',
      ']'
    );
    expect(block).toBe("['single ]', \"double ]\", `template ]`, { key: 'value' }]");
  });
});

describe('Dashboard keeps our real data architecture (no mock regression)', () => {
  it('imports no mock-data layer or teammate mock providers', () => {
    expect(code).not.toMatch(/data\/mockData/);
    expect(code).not.toMatch(/\bmockData\b/);
    expect(code).not.toMatch(/mocks\/|fixtures\//);
    expect(code).not.toMatch(/useSavedRecipes|useCommunity|useSearchHistory|useNotifications|useProfile/);
    expect(code).not.toMatch(/CRAVINGS|ingredientSwaps|communityPosts|chatMessages/);
  });

  it('fetches recipes from the real REST service', () => {
    expect(raw).toMatch(/import \{ listRecipes \} from '\.\.\/api\/recipeService'/);
    expect(code).toMatch(/listRecipes\(\{ sort: 'newest'/);
    expect(code).toMatch(/listRecipes\(\{ search: trimmed/);
    expect(raw).toMatch(/getRecipeErrorMessage/);
  });

  it('never fakes loading or hard-codes a recipe list', () => {
    expect(code).not.toMatch(/setTimeout\([^,]*,\s*\d{3,}\s*\)/); // no fake latency
    expect(code).not.toMatch(/const\s+(recipes|RECIPES|TRENDING|HERO)\s*=\s*\[/);
  });

  it('keeps the real Favorites + image components on recipe cards', () => {
    expect(raw).toMatch(/import FavoriteHeart from '\.\.\/components\/FavoriteHeart'/);
    expect(raw).toMatch(/import RecipeImage from '\.\.\/components\/RecipeImage'/);
    expect(code).toMatch(/<FavoriteHeart\b/);
    expect(code).toMatch(/<RecipeImage\b/);
  });

  it('renders recipe photography from the backend imageUrl only', () => {
    expect(code).toMatch(/source=\{recipe\.imageUrl\}|source=\{feature\.imageUrl\}/);
    // No remote stock-photo URLs, no require()-wrapped-in-uri (SDK57).
    expect(code).not.toMatch(/https?:\/\//);
    expect(code).not.toMatch(/unsplash|picsum|pravatar|gmanews/i);
    expect(code).not.toMatch(/\{\s*uri:\s*require\(/);
    expect(code).not.toMatch(/\brequire\(/);
  });
});

describe('Dashboard does not cross the navigation / auth boundary', () => {
  it('never replaces or resets into MainTabs', () => {
    // navigation.replace / .reset specifically — String.prototype.replace is fine.
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/\.replace\(\s*['"`]MainTabs/);
    expect(code).not.toMatch(/MainTabs/);
  });

  it('navigates only to existing WeCooked destinations', () => {
    const targets = [...code.matchAll(/navigation\.navigate\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(['RecipeDetail', 'Discover', 'Saved']).toContain(t);
    }
  });

  it('opens Recipe Detail with our API param shape, not a teammate recipe object', () => {
    expect(code).toMatch(/navigation\.navigate\('RecipeDetail',\s*\{/);
    expect(code).toMatch(/recipeSource: 'api'/);
    expect(code).toMatch(/recipeId: recipe\.id/);
    expect(code).not.toMatch(/navigate\('RecipeDetail',\s*\{\s*recipe\s*\}/);
    expect(code).not.toMatch(/navigate\('Search'|navigate\('Grocery'|navigate\('Onboarding'/);
  });

  it('wires the teammate-authoritative Saved entry point through TopBar', () => {
    // The only navigate('Saved') call anywhere in the teammate app (c1c86ed)
    // is the Dashboard header bookmark icon — restored here via TopBar's
    // opt-in `onSavedPress`, not a forked/local header.
    expect(code.match(/<TopBar\b/g) || []).toHaveLength(1);
    const [header] = code.match(/<TopBar\b[\s\S]*?\/>/g) || [];
    expect(header).toBeDefined();
    expect(header).toMatch(/\bmode\s*=\s*"brand"/);
    expect(header).toMatch(
      /\bonSavedPress\s*=\s*\{\s*\(\)\s*=>\s*navigation\.navigate\(\s*'Saved'\s*\)\s*\}/
    );
  });

  it('holds no authentication, session, or token state of its own', () => {
    expect(code).not.toMatch(/SecureStore|expo-secure-store|tokenStore/);
    expect(code).not.toMatch(/accessToken|refreshToken|idToken/);
    expect(code).not.toMatch(/setIsLoggedIn|markLoggedIn|fakeLogin|demoLogin/);
    // useAuth is READ-ONLY here — only the user object, for the greeting.
    expect(code).toMatch(/const \{ user \} = useAuth\(\)/);
  });
});

describe('recent searches — device-local, persisted, visible whenever present', () => {
  it('stores only through utils/storage — never AsyncStorage / auth / token storage', () => {
    expect(raw).toMatch(/import \{ loadJSON, saveJSON \} from '\.\.\/utils\/storage'/);
    expect(code).toMatch(/RECENT_SEARCH_KEY = 'wecooked:recentSearches'/);
    expect(code).not.toMatch(/AsyncStorage/);
    expect(code).not.toMatch(/SecureStore|tokenStore/);
  });

  it('hydrates once from storage and persists every change via one guarded effect', () => {
    expect(code).toMatch(/loadJSON\(RECENT_SEARCH_KEY, \[\]\)/);
    expect(code).toMatch(/recentHydratedRef/);
    // The ONLY writer: an effect keyed on `recent`, gated by the hydrate flag so
    // the empty seed never clobbers stored history.
    expect(code).toMatch(
      /if \(!recentHydratedRef\.current\) return;[\s\S]*?saveJSON\(RECENT_SEARCH_KEY, recent\);[\s\S]*?\}, \[recent\]\)/
    );
    // saveJSON is not fired from inside a state updater any more.
    expect(code).not.toMatch(/setRecent\(\(prev\) => \{[\s\S]*?saveJSON/);
  });

  it('records only an intentional search — keyboard submit or opening a result', () => {
    // The keyboard "search" key is the one text-field trigger.
    expect(code).toMatch(/onSubmitEditing=\{\(\) => rememberSearch\(trimmed\)\}/);
    // Blur / end-of-edit must NOT persist a half-typed query.
    expect(code).not.toMatch(/onEndEditing/);
    expect(code).not.toMatch(/onBlur=\{[^}]*rememberSearch/);
    // Opening a result while searching is the other allowed trigger.
    expect(code).toMatch(/if \(searching\) rememberSearch\(trimmed\);/);
  });

  it('normalizes / dedupes / caps / newest-first', () => {
    const fn = code.match(/const rememberSearch = useCallback\(\(raw\) => \{[\s\S]*?\}, \[\]\);/);
    expect(fn).not.toBeNull();
    expect(fn[0]).toMatch(/String\(raw \|\| ''\)\.trim\(\)/); // normalize
    expect(fn[0]).toMatch(/if \(!value\) return;/); // whitespace-only never stored
    expect(fn[0]).toMatch(/v\.toLowerCase\(\) !== value\.toLowerCase\(\)/); // dedupe
    expect(fn[0]).toMatch(/\.slice\(0, RECENT_SEARCH_MAX\)/); // cap
    expect(fn[0]).toMatch(/\[\s*value,/); // newest term to the front
  });

  it('Clear resets React state (the persist effect then writes [])', () => {
    const fn = code.match(/const clearRecent = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\);/);
    expect(fn).not.toBeNull();
    expect(fn[0]).toMatch(/setRecent\(\[\]\)/);
  });

  it('the chip list shows whenever history exists — NOT gated behind !searching', () => {
    expect(code).toMatch(/\{recent\.length > 0 && \(/);
    expect(code).not.toMatch(/!searching && recent\.length/);
  });

  it('chip / Clear taps survive an open keyboard', () => {
    expect(code).toMatch(/keyboardShouldPersistTaps="handled"/);
  });

  it('keeps the cap at 6', () => {
    expect(code).toMatch(/RECENT_SEARCH_MAX = 6/);
  });
});

describe('every Dashboard -> Discover jump carries an explicit filter (no stale shortcut)', () => {
  it('routes through openDiscover, which defaults to the unfiltered "all" key', () => {
    expect(code).toMatch(
      /const openDiscover = \(filterKey\) =>[\s\S]*?navigation\.navigate\('Discover', \{ initialFilter: filterKey \|\| 'all' \}\)/
    );
  });

  it('never calls navigate(\'Discover\') without params', () => {
    // A bare navigate('Discover') leaves the already-mounted tab on its old filter
    // (the physical M2.1 "See all stays on Vegan" defect).
    expect(code).not.toMatch(/navigate\(\s*['"`]Discover['"`]\s*\)/);
    const discoverCalls = [
      ...code.matchAll(/navigate\(\s*['"`]Discover['"`]\s*,\s*\{([^}]*)\}/g),
    ].map((m) => m[1]);
    expect(discoverCalls.length).toBeGreaterThan(0);
    for (const args of discoverCalls) {
      expect(args).toMatch(/initialFilter/);
    }
  });

  it('"See all" / the filter button reset to unfiltered; browse chips pass their key', () => {
    expect(code).toMatch(/onPress=\{\(\) => openDiscover\(\)\}/);
    expect(code).toMatch(/onPress=\{\(\) => openDiscover\(shortcut\.key\)\}/);
  });
});

describe('no new cuisine-based UX (locked M2 decision — cuisine leaves in M3)', () => {
  const shortcutsBlock = code.match(/const BROWSE_SHORTCUTS = \[[\s\S]*?\];/);

  it('the browse row exists and links only to backend-supported non-cuisine filters', () => {
    expect(shortcutsBlock).not.toBeNull();
    const keys = [...shortcutsBlock[0].matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(['easy', 'vegetarian', 'vegan']).toContain(k);
    }
  });

  it('adds no cuisine or category filter UI/query wiring on Home', () => {
    expect(code).not.toMatch(/cuisine/i);
    expect(code).not.toMatch(/\bFilipino\b|\bregion\b|\bLuzon\b|\bVisayas\b|\bMindanao\b/);
    expect(
      hasVisibleLabelFamily(code, [
        'category',
        'categories',
        'browse by category',
        'browse by categories',
        'browse by craving',
      ])
    ).toBe(false);
    expect(code).not.toMatch(/\b(?:setCategory|activeCategory|categoryFilter|initialCategory)\b/);

    const queries = [...code.matchAll(/listRecipes\s*\(\s*(\{[\s\S]*?\})\s*\)/g)].map(
      (match) => match[1]
    );
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) expect(hasCategoryQueryKey(query)).toBe(false);
  });

  it('allows legitimate recipe.category reads while detecting category query/UI semantics', () => {
    expect(hasCategoryQueryKey('const label = recipe.category;')).toBe(false);
    expect(hasCategoryQueryKey('const query = { category: selectedCategory };')).toBe(true);
    expect(hasVisibleLabelFamily("<Text>{'Browse by category'}</Text>", ['browse by category'])).toBe(
      true
    );
  });
});

describe('Today’s Pick is derived, not a fabricated editorial flag', () => {
  it('picks deterministically from the real latest list', () => {
    expect(code).toMatch(/featureIndexForToday/);
    expect(code).toMatch(/latest\[featureIndexForToday\(latest\.length\)\]/);
    expect(code).not.toMatch(/isFeatured|featuredFlag|editorPick|curated/i);
  });

  it('uses neutral daily-pick wording rather than claiming editorial selection', () => {
    expect(code).toMatch(/TODAY'S PICK/);
    expect(code).not.toMatch(/TODAY'S FEATURE/);
  });
});

describe('unsupported teammate Dashboard concepts stay out of production', () => {
  it('keeps the shortcut set exactly Easy, Vegetarian, and Vegan', () => {
    const shortcutsBlock = extractBalancedAfter(code, 'const BROWSE_SHORTCUTS =', '[', ']');
    expect(shortcutsBlock).not.toBeNull();
    const keys = [...shortcutsBlock.matchAll(/\bkey\s*:\s*(['"])([^'"]+)\1/g)].map(
      (match) => match[2]
    );
    expect(keys).toEqual(['easy', 'vegetarian', 'vegan']);
  });

  it('adds no Trending, Recently Viewed, Grocery, or global substitution entry point', () => {
    expect(staticTextNodes(code).map((label) => label.toLowerCase())).toContain('latest recipes');
    expect(hasVisibleLabelFamily(code, ['trending', 'recently viewed'])).toBe(false);
    expect(code).not.toMatch(/\buseRecentlyViewed\s*\(/);

    const targets = [...code.matchAll(/navigation\.navigate\(\s*(['"])([^'"]+)\1/g)].map(
      (match) => match[2]
    );
    expect(targets).not.toEqual(expect.arrayContaining(['Trending', 'Grocery', 'IngredientStudio']));
    expect(code).not.toMatch(/swap-horizontal/);
  });

  it('recognizes prohibited quoted static labels but ignores dynamic JSX expressions', () => {
    expect(staticTextNodes("<Text>{'Trending'}</Text>")).toEqual(['Trending']);
    expect(staticTextNodes('<Text>{"Trending recipes"}</Text>')).toEqual(['Trending recipes']);
    expect(staticTextNodes("<Text>{'Recently Viewed recipes'}</Text>")).toEqual([
      'Recently Viewed recipes',
    ]);
    expect(hasVisibleLabelFamily("<Text>{'Trending meals'}</Text>", ['trending'])).toBe(true);
    expect(
      hasVisibleLabelFamily("<Text>{'Recently Viewed recipes'}</Text>", ['recently viewed'])
    ).toBe(true);
    expect(staticTextNodes('<Text>{title}</Text>')).toEqual([]);
    expect(staticTextNodes('<Text>{getTitle()}</Text>')).toEqual([]);
    expect(staticTextNodes("<Text>{condition ? 'Trending' : 'Latest'}</Text>")).toEqual([]);
  });
});

describe('greeting is derived from the authenticated user', () => {
  it('uses the real user name, not a hard-coded chef name', () => {
    expect(code).toMatch(/firstNameOf\(user\)/);
    expect(code).not.toMatch(/Chef Ninong Ry|Chef Kirby|Hello, Chef! /);
  });
});
