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

function extractBalancedAfter(src, anchor, open = '{', close = '}') {
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
        // Preserve simple static JSX string expressions before removing
        // genuinely dynamic expressions: <Text>{'Discover'}</Text>.
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

const raw = read('screens/DiscoverScreen.js');
const code = stripComments(raw);

describe('static audit source helpers', () => {
  it('fails closed for missing, duplicate, and unbalanced anchors', () => {
    expect(extractBalancedAfter('const value = { ok: true };', 'missing')).toBeNull();
    expect(extractBalancedAfter('anchor { one: 1 }; anchor { two: 2 };', 'anchor')).toBeNull();
    expect(extractBalancedAfter('anchor { one: 1;', 'anchor')).toBeNull();
  });

  it('ignores delimiters inside ordinary quoted strings', () => {
    const block = extractBalancedAfter(
      "anchor { single: '}', double: \"}\", template: `}`, nested: { ok: true } }",
      'anchor'
    );
    expect(block).toBe("{ single: '}', double: \"}\", template: `}`, nested: { ok: true } }");
  });
});

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

describe('Discover uses the pushed-screen header contract', () => {
  it('renders one Back + Discover title TopBar without Dashboard Saved opt-in', () => {
    expect(code.match(/<TopBar\b/g) || []).toHaveLength(1);
    const [header] = code.match(/<TopBar\b[\s\S]*?\/>/g) || [];
    expect(header).toBeDefined();
    expect(header).toMatch(/\bmode\s*=\s*"back"/);
    expect(header).toMatch(/\btitle\s*=\s*"Discover"/);
    expect(header).toMatch(
      /\bonBack\s*=\s*\{\s*\(\)\s*=>\s*navigation\.goBack\(\s*\)\s*\}/
    );
    expect(header).not.toMatch(/\bmode\s*=\s*"brand"/);
  });

  it('keeps the TopBar as the only Discover title presentation', () => {
    expect(code).not.toMatch(/styles\.pageTitle/);
    expect(code).not.toMatch(/\bpageTitle\s*:/);
    expect(staticTextNodes(code)).not.toContain('Discover');
  });

  it('recognizes quoted JSX text literals without treating dynamic expressions as static copy', () => {
    expect(staticTextNodes("<Text>{'Discover'}</Text>")).toEqual(['Discover']);
    expect(staticTextNodes('<Text>{"Discover"}</Text>')).toEqual(['Discover']);
    expect(staticTextNodes('<Text>{dynamicTitle}</Text>')).toEqual([]);
  });
});

describe('Clear-all owns only search and the supported filter selection', () => {
  it('clears search immediately and selects the real all filter', () => {
    const clearAll = extractBalancedAfter(code, 'const clearAll = () =>');
    expect(clearAll).not.toBeNull();
    expect(clearAll).toMatch(/setSearch\(\s*['"]{2}\s*\)/);
    expect(clearAll).toMatch(/setDebouncedSearch\(\s*['"]{2}\s*\)/);
    expect(clearAll).toMatch(/setActiveKey\(\s*['"]all['"]\s*\)/);
    expect(clearAll).not.toMatch(/setFilters|AsyncStorage|saveJSON|navigation\./);
  });

  it('a first-page supersession resets both load-more flags before its request', () => {
    const loadFirstPage = extractBalancedAfter(code, 'async ({ refresh = false } = {}) =>');
    expect(loadFirstPage).not.toBeNull();

    const generation = loadFirstPage.indexOf('const gen = ++genRef.current');
    const firstPageGuard = loadFirstPage.indexOf('firstPageGenRef.current = gen');
    const refReset = loadFirstPage.indexOf('loadingMoreRef.current = false');
    const stateReset = loadFirstPage.indexOf('setLoadingMore(false)');
    const refreshBranch = loadFirstPage.indexOf('if (refresh)');
    const request = loadFirstPage.indexOf('await listRecipes(queryFor(1))');

    expect(generation).toBeGreaterThanOrEqual(0);
    expect(firstPageGuard).toBeGreaterThan(generation);
    expect(refReset).toBeGreaterThan(firstPageGuard);
    expect(stateReset).toBeGreaterThan(refReset);
    expect(refreshBranch).toBeGreaterThan(stateReset);
    expect(request).toBeGreaterThan(stateReset);
  });

  it('blocks load-more while the current generation owns a first-page request', () => {
    const loadMore = extractBalancedAfter(code, 'const loadMore = useCallback(');
    expect(loadMore).not.toBeNull();

    const firstPageGate = loadMore.indexOf(
      'if (firstPageGenRef.current === genRef.current) return'
    );
    const loadMoreGate = loadMore.indexOf('if (loadingMoreRef.current) return');
    const request = loadMore.indexOf('await listRecipes(queryFor(nextPage))');

    expect(firstPageGate).toBeGreaterThanOrEqual(0);
    expect(loadMoreGate).toBeGreaterThan(firstPageGate);
    expect(request).toBeGreaterThan(loadMoreGate);
  });

  it('only the owning first-page generation can release its in-flight guard', () => {
    const loadFirstPage = extractBalancedAfter(code, 'async ({ refresh = false } = {}) =>');
    expect(loadFirstPage).not.toBeNull();
    const finallyBlock = extractBalancedAfter(loadFirstPage, 'finally');
    expect(finallyBlock).not.toBeNull();
    expect(finallyBlock).toMatch(
      /if \(firstPageGenRef\.current === gen\) firstPageGenRef\.current = null/
    );
  });

  it('stale load-more completion cannot mutate results or clean up a newer generation', () => {
    const loadMore = extractBalancedAfter(code, 'const loadMore = useCallback(');
    expect(loadMore).not.toBeNull();
    expect(loadMore).toMatch(
      /await listRecipes\(queryFor\(nextPage\)\);\s*if \(!mountedRef\.current \|\| gen !== genRef\.current\) return;\s*setRecipes/
    );

    const finallyBlock = extractBalancedAfter(loadMore, 'finally');
    expect(finallyBlock).not.toBeNull();
    expect(finallyBlock).toMatch(
      /if \(mountedRef\.current && gen === genRef\.current\)\s*\{[\s\S]*loadingMoreRef\.current = false;[\s\S]*setLoadingMore\(false\)/
    );
  });
});

describe('Discover search-row layout', () => {
  it('lets the outer search surface consume remaining width beside Clear', () => {
    const searchFieldStyle = extractBalancedAfter(code, 'searchField:');
    expect(searchFieldStyle).not.toBeNull();
    expect(searchFieldStyle).toMatch(/\bflex\s*:\s*1\b/);
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
  it('adds no cuisine or category filter UI/query wiring', () => {
    expect(code).not.toMatch(/cuisine/i);
    expect(code).not.toMatch(/\bFilipino\b|\bLuzon\b|\bVisayas\b|\bMindanao\b|\bregion\b/);
    expect(code).not.toMatch(/craving/i);

    expect(
      hasVisibleLabelFamily(code, [
        'category',
        'categories',
        'browse by category',
        'browse by categories',
      ])
    ).toBe(false);
    expect(code).not.toMatch(/\b(?:setCategory|activeCategory|categoryFilter|initialCategory)\b/);

    const queryFor = extractBalancedAfter(code, 'const queryFor = useCallback(');
    expect(queryFor).not.toBeNull();
    expect(hasCategoryQueryKey(queryFor)).toBe(false);
  });

  it('allows legitimate recipe.category reads while detecting category query/UI semantics', () => {
    expect(hasCategoryQueryKey('const label = recipe.category;')).toBe(false);
    expect(hasCategoryQueryKey('const query = { category: selectedCategory };')).toBe(true);
    expect(hasVisibleLabelFamily('<Text>Categories</Text>', ['category', 'categories'])).toBe(
      true
    );
  });

  it('renders none of the unsupported teammate filter or feed sections', () => {
    expect(
      hasVisibleLabelFamily(code, [
        'cuisine',
        'mood',
        'cooking time',
        'sort',
        'trending',
        'recently viewed',
      ])
    ).toBe(false);
    expect(code).not.toMatch(/\buseRecentlyViewed\s*\(|\buseSearchHistory\s*\(/);
    expect(code).not.toMatch(/\bSORT_OPTIONS\b|\bTIME_BUCKETS\b|\bVIBES\b/);
  });
});
