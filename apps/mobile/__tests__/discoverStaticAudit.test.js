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

function extractUniqueSelfClosingJsxTag(src, tagName) {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...src.matchAll(new RegExp(`<${escapedTagName}\\b`, 'g'))];
  if (matches.length !== 1) return null;

  const start = matches[0].index;
  let braceDepth = 0;
  let quote = null;
  let escaped = false;

  for (let i = start + matches[0][0].length; i < src.length; i += 1) {
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
    if (char === '{') braceDepth += 1;
    else if (char === '}') {
      if (braceDepth === 0) return null;
      braceDepth -= 1;
    } else if (braceDepth === 0 && char === '>' && src[i - 1] !== '/') {
      return null;
    } else if (braceDepth === 0 && char === '/' && src[i + 1] === '>') {
      return src.slice(start, i + 2);
    }
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

function hasUnsupportedSortSemantics(src) {
  const executable = stripComments(src);
  return [
    /\bsort\s*:\s*(['"])(?:rating|popularity)\1/i,
    /\bsort\s*=\s*(['"])(?:rating|popularity)\1/i,
    /\bsetSort\s*\(\s*(['"])(?:rating|popularity)\1\s*\)/i,
    /\b(?:query|params|filters)\.sort\s*=\s*(['"])(?:rating|popularity)\1/i,
    /\.set\s*\(\s*(['"])sort\1\s*,\s*(['"])(?:rating|popularity)\2\s*\)/i,
  ].some((pattern) => pattern.test(executable));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasClientSideRecipeFiltering(src) {
  const executable = stripComments(src);
  const collections = new Set(['recipes', 'data.recipes']);
  const aliasPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:;|\n|$)/g;

  let addedAlias = true;
  while (addedAlias) {
    addedAlias = false;
    for (const match of executable.matchAll(aliasPattern)) {
      if (collections.has(match[2]) && !collections.has(match[1])) {
        collections.add(match[1]);
        addedAlias = true;
      }
    }
  }

  return [...collections].some((collection) => {
    const root = escapeRegExp(collection);
    const directFilter = new RegExp(
      `${root}\\s*(?:\\?\\.|\\.|\\[\\s*['"])(?:filter)(?:['"]\\s*\\])?\\s*\\(`
    );
    const borrowedFilter = new RegExp(
      `Array\\.prototype\\.filter\\.(?:call|apply)\\(\\s*${root}\\b`
    );
    const wrappedFilter = new RegExp(
      `(?:Array\\.from\\(\\s*${root}\\s*\\)|\\[\\s*\\.\\.\\.${root}\\s*\\])\\s*\\.\\s*filter\\s*\\(`
    );
    const subsetReduce = new RegExp(
      `${root}\\s*\\.\\s*reduce\\s*\\([\\s\\S]{0,500},\\s*\\[\\]\\s*\\)`
    );
    const conditionalLoop = new RegExp(
      `for\\s*\\([^)]*\\bof\\s+${root}\\s*\\)\\s*\\{[\\s\\S]{0,500}?\\bif\\s*\\([\\s\\S]{0,200}?\\)[\\s\\S]{0,300}?\\.push\\s*\\(`
    );
    return [directFilter, borrowedFilter, wrappedFilter, subsetReduce, conditionalLoop].some(
      (pattern) => pattern.test(executable)
    );
  });
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

  it('extracts exactly one structurally complete self-closing JSX tag', () => {
    const block = extractUniqueSelfClosingJsxTag(
      '<FlatList data={items} refreshControl={<RefreshControl onRefresh={refresh} />} />',
      'FlatList'
    );
    expect(block).toBe(
      '<FlatList data={items} refreshControl={<RefreshControl onRefresh={refresh} />} />'
    );
    expect(extractUniqueSelfClosingJsxTag('<View />', 'FlatList')).toBeNull();
    expect(extractUniqueSelfClosingJsxTag('<FlatList /><FlatList />', 'FlatList')).toBeNull();
    expect(extractUniqueSelfClosingJsxTag('<FlatList data={items}', 'FlatList')).toBeNull();
  });

  it('distinguishes executable unsupported sort values from harmless copy', () => {
    expect(hasUnsupportedSortSemantics("const query = { sort: 'rating' };")).toBe(true);
    expect(hasUnsupportedSortSemantics('const query = { sort: "popularity" };')).toBe(true);
    expect(hasUnsupportedSortSemantics("filters.sort = 'rating';")).toBe(true);
    expect(hasUnsupportedSortSemantics("params.set('sort', 'popularity');")).toBe(true);
    expect(hasUnsupportedSortSemantics('<Text>Popular recipes</Text>')).toBe(false);
    expect(hasUnsupportedSortSemantics('// sort: rating is unsupported')).toBe(false);
  });

  it('detects targeted client-side filtering forms without rejecting unrelated array work', () => {
    expect(hasClientSideRecipeFiltering('const visible = data.recipes.filter(isVisible);')).toBe(
      true
    );
    expect(
      hasClientSideRecipeFiltering(
        'const pageRecipes = data.recipes; const visible = pageRecipes["filter"](isVisible);'
      )
    ).toBe(true);
    expect(
      hasClientSideRecipeFiltering('const visible = Array.from(data.recipes).filter(isVisible);')
    ).toBe(true);
    expect(
      hasClientSideRecipeFiltering(
        'const visible = data.recipes.reduce((out, recipe) => isVisible(recipe) ? [...out, recipe] : out, []);'
      )
    ).toBe(true);
    expect(
      hasClientSideRecipeFiltering(
        'for (const recipe of data.recipes) { if (isVisible(recipe)) visible.push(recipe); }'
      )
    ).toBe(true);
    expect(hasClientSideRecipeFiltering('const labels = options.filter(Boolean);')).toBe(false);
    expect(hasClientSideRecipeFiltering('const rows = recipes.map(renderRecipe);')).toBe(false);
    expect(hasClientSideRecipeFiltering('const count = recipes.reduce((n) => n + 1, 0);')).toBe(
      false
    );
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
    expect(clearAll).toMatch(/setAppliedFilters\(presetFilters\(\s*['"]all['"]\s*\)\)/);
    expect(clearAll).not.toMatch(/\bsetFilters\b|AsyncStorage|saveJSON|navigation\./);
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

describe('approved pinned Discover presentation remains attached to real results', () => {
  const renderItem = extractBalancedAfter(code, 'const renderItem = ({ item }) =>', '(', ')');
  const openRecipe = extractBalancedAfter(code, 'const openRecipe = (recipe) =>');
  const countLabelCalculation = extractBalancedAfter(code, 'const countLabel = useMemo(() =>');
  const renderedCount = extractBalancedAfter(code, 'countLabel &&', '(', ')');
  const discoverList = extractUniqueSelfClosingJsxTag(code, 'FlatList');

  it('uniquely isolates a real result row and its RecipeDetail action', () => {
    expect(renderItem).not.toBeNull();
    expect(openRecipe).not.toBeNull();
    expect(renderItem).toMatch(/onPress=\{\(\) => openRecipe\(item\)\}/);
    expect(openRecipe).toMatch(/navigation\.navigate\('RecipeDetail',\s*\{/);
    expect(openRecipe).toMatch(/recipeSource:\s*'api'/);
    expect(openRecipe).toMatch(/recipeId:\s*recipe\.id/);
    expect(openRecipe).toMatch(/initialRecipe:\s*recipe/);
  });

  it('keeps backend imagery, favorite control, and result navigation structurally independent', () => {
    expect(renderItem).not.toBeNull();
    expect(renderItem.match(/<Pressable\b/g) || []).toHaveLength(1);
    expect(renderItem.match(/<FavoriteHeart\b/g) || []).toHaveLength(1);
    expect(renderItem).toMatch(/<RecipeImage source=\{item\.imageUrl\}/);

    const pressableEnd = renderItem.indexOf('</Pressable>');
    const favoriteStart = renderItem.indexOf('<FavoriteHeart');
    expect(pressableEnd).toBeGreaterThanOrEqual(0);
    expect(favoriteStart).toBeGreaterThan(pressableEnd);
    expect(renderItem.slice(0, pressableEnd)).not.toMatch(/<FavoriteHeart\b/);
    expect(renderItem).toMatch(/<FavoriteHeart recipe=\{item\}/);
  });

  it('keeps the accessible compact row attached to the real result item', () => {
    expect(renderItem).not.toBeNull();
    expect(renderItem).toMatch(/accessibilityLabel=\{`Open \$\{item\.title\}`\}/);
    expect(renderItem).toMatch(/\{item\.title\}/);
    expect(renderItem).toMatch(/\{metaLine\(item\)\}/);
    expect(renderItem).not.toMatch(/mock|fixture|localRecipe|hardCoded/i);
  });

  it('binds the unique Discover FlatList to real recipes and the isolated row renderer', () => {
    expect(discoverList).not.toBeNull();
    expect(discoverList).toMatch(/\bdata\s*=\s*\{recipes\}/);
    expect(discoverList).toMatch(/\brenderItem\s*=\s*\{renderItem\}/);
    expect(discoverList).toMatch(/\bonEndReached\s*=\s*\{loadMore\}/);
    expect(discoverList).toMatch(
      /\brefreshControl\s*=\s*\{\s*<RefreshControl[\s\S]*?\bonRefresh\s*=\s*\{\(\) => loadFirstPage\(\{ refresh: true \}\)\}/
    );
  });

  it('uses the compact image-led teammate result treatment without a duplicate shadow source', () => {
    const rowStyle = extractBalancedAfter(code, '    row:');
    const thumbStyle = extractBalancedAfter(code, '    thumb:');

    expect(rowStyle).not.toBeNull();
    expect(rowStyle).toMatch(/backgroundColor\s*:\s*colors\.creamDeep/);
    expect(rowStyle).not.toMatch(/shadow\./);
    expect(thumbStyle).not.toBeNull();
    expect(thumbStyle).toMatch(/width\s*:\s*60/);
    expect(thumbStyle).toMatch(/height\s*:\s*60/);
    expect(renderItem).not.toBeNull();
    expect(renderItem).toMatch(/<RecipeImage source=\{item\.imageUrl\}/);
  });

  it('renders recipes.length with a plus only while additional pages remain', () => {
    expect(countLabelCalculation).not.toBeNull();
    expect(countLabelCalculation).toMatch(/const n = recipes\.length/);
    expect(countLabelCalculation).toMatch(
      /const more = pagination && pageLoaded < \(pagination\.totalPages \|\| 0\)/
    );
    expect(countLabelCalculation).toMatch(/\$\{n\}\$\{more \? ['"]\+['"] : ['"]{2}\}/);

    expect(renderedCount).not.toBeNull();
    expect(renderedCount).toMatch(/<View style=\{styles\.countRow\}>/);
    expect(renderedCount).toMatch(/<Text style=\{styles\.countLabel\}>\{countLabel\} found<\/Text>/);
  });

  it('keeps the rendered result summary uppercase', () => {
    expect(code).toMatch(/textTransform\s*:\s*['"]uppercase['"]/);
  });

  it('labels the single search input and supported filter controls for assistive technology', () => {
    const searchInputs = code.match(/<TextInput\b[\s\S]*?\/>/g) || [];
    const filterMap = extractBalancedAfter(code, '{M2_FILTERS.map', '(', ')');

    expect(searchInputs).toHaveLength(1);
    expect(searchInputs[0]).toMatch(/accessibilityLabel="Search recipes"/);
    expect(filterMap).not.toBeNull();
    expect(filterMap).toMatch(/accessibilityLabel=\{`Filter recipes by \$\{f\.label\}`\}/);
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

  it('seeds applied filters from route.params.initialFilter on first mount', () => {
    expect(code).toMatch(/route\.params\?\.initialFilter/);
    expect(code).toMatch(/presetFilters\(k && FILTER_BY_KEY\[k\] \? k : 'all'\)/);
  });

  it('re-consumes initialFilter on the already-mounted tab, then clears the param', () => {
    expect(code).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?route\.params\?\.initialFilter[\s\S]*?setAppliedFilters\(\(current\) => presetFiltersState\(current, key\)\)[\s\S]*?navigation\.setParams\(\{ initialFilter: undefined \}\)[\s\S]*?\}, \[route\.params\?\.initialFilter, navigation\]\)/
    );
  });

  it('preserves the seeded preset identity so the first-page dependency does not transition twice', () => {
    expect(raw).toMatch(/presetFiltersState/);
    expect(code).toMatch(/setAppliedFilters\(\(current\) => presetFiltersState\(current, key\)\)/);
    expect(code).toMatch(/\[appliedFilters, debouncedSearch\]/);
    expect(code).toMatch(/\}, \[loadFirstPage\]\)/);
  });
});

describe('P3 server-authoritative advanced filters', () => {
  const sheetRaw = read('components/DiscoverFiltersSheet.js');
  const sheetCode = stripComments(sheetRaw);

  it('builds search, approved filters, and pagination into the same request', () => {
    const queryFor = extractBalancedAfter(code, 'const queryFor = useCallback(');
    expect(queryFor).not.toBeNull();
    expect(queryFor).toMatch(/discoverFilterQuery\(appliedFilters\)/);
    expect(queryFor).toMatch(/search: debouncedSearch/);
    expect(queryFor).toMatch(/page,/);
    expect(queryFor).toMatch(/limit: PAGE_LIMIT/);
    expect(code).toMatch(/listRecipes\(queryFor\(1\)\)/);
    expect(code).toMatch(/listRecipes\(queryFor\(nextPage\)\)/);
  });

  it('uses replacement presets and leaves non-preset combinations unselected', () => {
    expect(code).toMatch(/const activePresetKey = selectedPresetKey\(appliedFilters\)/);
    expect(code).toMatch(/const isActive = f\.key === activePresetKey/);
    expect(code).toMatch(/setAppliedFilters\(presetFilters\(key\)\)/);
    expect(code).toMatch(/filterCount > 0 \? `Filters, \$\{filterCount\} active`/);
  });

  it('resets pagination through the first-page dependency when applied filters change', () => {
    expect(code).toMatch(/\[appliedFilters, debouncedSearch\]/);
    expect(code).toMatch(/useEffect\(\(\) => \{\s*loadFirstPage\(\);\s*\}, \[loadFirstPage\]\)/);
    expect(code).toMatch(/setPageLoaded\(0\)/);
  });

  it('keeps filter changes draft-only until Apply and supports Cancel, back, and Reset', () => {
    expect(sheetCode).toMatch(/if \(!visible\) return;[\s\S]*setDraft\(draftFromFilters\(appliedFilters\)\)/);
    expect(sheetCode).toMatch(/onRequestClose=\{cancel\}/);
    expect(sheetCode).toMatch(/const reset = \(\) => \{[\s\S]*setDraft\(draftFromFilters\(\{\}\)\)/);
    expect(sheetCode).toMatch(/if \(!result\.filters\) return;\s*onApply\(result\.filters\)/);
    expect(sheetCode).not.toMatch(/listRecipes\(/);
  });

  it('provides accessible themed controls and maximum-prep validation', () => {
    expect(sheetCode).toMatch(/accessibilityRole="radiogroup"/);
    expect(sheetCode).toMatch(/accessibilityState=\{\{ selected \}\}/);
    expect(sheetCode).toMatch(/accessibilityLabel="Maximum prep minutes, from 1 to 1440"/);
    expect(sheetCode).toMatch(/keyboardType="number-pad"/);
    expect(sheetCode).toMatch(/accessibilityLiveRegion="polite"/);
    expect(sheetCode).toMatch(/useTheme\(\)/);
    expect(sheetCode).toMatch(/minHeight: 44/);
  });

  it('does not locally filter returned recipe pages', () => {
    expect(hasClientSideRecipeFiltering(code)).toBe(false);
    expect(code).toMatch(/const nextRecipes = dedupeById\(data\.recipes\)/);
    expect(code).toMatch(/setRecipes\(\(prev\) => mergeById\(prev, data\.recipes\)\)/);
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

  it('adds no ranking, recommendation, nutrition, or fake popularity query semantics', () => {
    expect(code).not.toMatch(
      /\b(?:const|let|var)\s+(?:trending|ranked|rankings|recommendations|recentlyViewed|nutritionFilters)\b/i
    );
    expect(code).not.toMatch(
      /\b(?:setTrending|setRanked|setRecommendations|setRecentlyViewed|recommendationScore|recommendationConfidence)\b/
    );
    expect(code).not.toMatch(
      /\.(?:sort)\([^)]*(?:rating|reviews|popularity|rank|score|confidence)/i
    );
    expect(code).not.toMatch(
      /\b(?:recipe|item|r)\.(?:rating|reviews|popularity|rank|recommendationScore|confidence|nutrition|calories|protein|carbs|fat)\b/i
    );

    const queryFor = extractBalancedAfter(code, 'const queryFor = useCallback(');
    expect(queryFor).not.toBeNull();
    expect(queryFor).not.toMatch(
      /\b(?:rating|popularity|rank|score|confidence|nutrition|calories|protein|carbs|fat)\s*:/i
    );
    expect(hasUnsupportedSortSemantics(code)).toBe(false);
  });
});
