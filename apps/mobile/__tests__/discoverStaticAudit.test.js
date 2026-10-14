const fs = require('fs');
const path = require('path');

const screen = fs.readFileSync(path.join(__dirname, '../src/screens/DiscoverScreen.js'), 'utf8');
const panel = fs.readFileSync(path.join(__dirname, '../src/components/DiscoverFiltersSheet.js'), 'utf8');
const recipeService = fs.readFileSync(path.join(__dirname, '../src/api/recipeService.js'), 'utf8');
const executableScreen = screen
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('MOBILE-DISC5 Search shell static contract', () => {
  it('retains the pinned compact cards and omits removed Vibe and Craving controls', () => {
    expect(screen).toMatch(/row: \{[\s\S]*?backgroundColor: colors\.creamDeep,[\s\S]*?borderRadius: 14,[\s\S]*?padding: 10/);
    expect(executableScreen).not.toMatch(/\b[Vv]ibe\b|\b[Cc]raving\b/);
  });
  it('opens with a left display title and accessible inline filters on demand', () => {
    const topBar = fs.readFileSync(path.join(__dirname, '../src/components/TopBar.js'), 'utf8');
    const panelStyle = panel.match(/panel: \{([\s\S]*?)\r?\n    \},\r?\n    header:/)?.[1];
    expect(screen).toMatch(/<TopBar mode="back" title="Search" variant="discover" transparent/);
    expect(topBar).toMatch(/titleDiscover: \{[\s\S]*?fontFamily: typography\.display\.fontFamily,[\s\S]*?fontSize: 20,[\s\S]*?textAlign: 'left'/);
    expect(screen).toMatch(/\[filtersOpen, setFiltersOpen\] = useState\(false\)/);
    expect(screen).toMatch(/accessibilityState=\{\{ expanded: filtersOpen \}\}/);
    expect(panelStyle).toBeDefined();
    expect(panelStyle).not.toMatch(/borderWidth|backgroundColor|borderRadius/);
    for (const label of ['Region', 'Category', 'Dietary', 'Total time', 'Maximum prep minutes', 'Ingredient']) {
      expect(panel).toContain(label);
    }
    expect(panel).not.toMatch(/\bVibe\b|\bCraving\b/);
  });
  it('is a pushed Search screen with one vertical FlatList hierarchy', () => {
    expect(screen).toMatch(/<TopBar mode="back" title="Search"/);
    expect(screen).toMatch(/<FlatList[\s\S]*ListHeaderComponent=/);
    expect(screen).toMatch(/showsVerticalScrollIndicator=\{false\}/);
    expect(screen).toMatch(/keyboardShouldPersistTaps="handled"/);
    expect(screen).toMatch(/placeholder="Search recipes\.\.\."/);
    expect(screen).toMatch(/maxLength=\{150\}/);
  });

  it('uses an inline staged filter panel, never a modal or bottom sheet', () => {
    expect(screen).toMatch(/<DiscoverFiltersSheet/);
    expect(panel).toMatch(/if \(!visible\) return null/);
    expect(panel).toMatch(/BackHandler\.addEventListener\('hardwareBackPress'/);
    expect(panel).not.toMatch(/\bModal\b|KeyboardAvoidingView|animationType="slide"/);
    expect(panel).toMatch(/setDraft\(draftFromFilters\(appliedFilters\)\)/);
    expect(panel).toMatch(/draftFromFilters\(\{ sort: appliedFilters\.sort \}\)/);
    expect(panel).toMatch(/onApply\(\{ \.\.\.result\.filters, sort: appliedFilters\.sort \}\)/);
    expect(panel).toMatch(/validateDiscoverFilterDraft\(draft\)/);
    expect(panel).toMatch(/Show recipes/);
  });

  it('bounds all canonical regions behind an accessible selector', () => {
    expect(panel).toMatch(/REGION_OPTIONS\.map\(\(option\) =>/);
    expect(panel).toMatch(/maxHeight: 224/);
    expect(panel).toMatch(/nestedScrollEnabled/);
    expect(panel).toMatch(/accessibilityState=\{\{ expanded: regionOpen \}\}/);
    expect(panel).toMatch(/region: option\.value/);
    expect(panel).toMatch(/setRegionOpen\(false\)/);
    expect(screen).toMatch(/<RecipeImage source=\{item\.imageUrl\}/);
    expect(screen).toMatch(/<FavoriteHeart recipe=\{item\}/);
  });

  it('keeps DISC6 dietary and total-time controls staged and wire projection bounded', () => {
    expect(panel).toMatch(/accessibilityRole="checkbox"/);
    expect(panel).toMatch(/accessibilityState=\{\{ checked \}\}/);
    expect(panel).toMatch(/label="Total time"/);
    expect(panel).toMatch(/setDraft\(\(current\) =>/);
    expect(recipeService).toMatch(/'dietaryTags'/);
    expect(recipeService).toMatch(/'totalTimeBucket'/);
    expect(recipeService).toMatch(/value\.join\(','\)/);
    expect(recipeService).not.toMatch(/\$expr|minimumTotalTime|maximumTotalTime/);
  });

  it('keeps exactly the eight supported sorts visible outside narrowing filters', () => {
    expect(screen).toMatch(/DISCOVER_SORT_OPTIONS\.map/);
    expect(screen).toMatch(/accessibilityLabel=\{`Sort: \$\{option\.label\}`\}/);
    expect(panel).not.toMatch(/DISCOVER_SORT_OPTIONS|label="Sort"/);
    expect(screen).not.toMatch(/popularity|trendingScore|For You/);
  });

  it('uses real server Recipe and canonical Ingredient authority', () => {
    expect(screen).toMatch(/import \{ listRecipes \} from '\.\.\/api\/recipeService'/);
    expect(panel).toMatch(/searchIngredientsStrict/);
    expect(screen).toMatch(/discoverFilterQuery\(appliedFilters\)/);
    expect(screen).toMatch(/page,\s*limit: PAGE_LIMIT/);
    expect(screen).toMatch(/pagination\.totalPages/);
    expect(executableScreen).not.toMatch(/mockData|fakeRefresh/);
  });

  it('takes immutable request snapshots before every awaited request', () => {
    expect(screen.match(/const snapshot = queryFor\(/g)).toHaveLength(2);
    expect(screen.match(/await listRecipes\(snapshot\)/g)).toHaveLength(2);
  });

  it('invalidates all visible and request ownership synchronously', () => {
    expect(screen).toMatch(/const invalidateForReplacement = useCallback/);
    for (const statement of [
      'genRef.current += 1',
      'firstPageGenRef.current = null',
      'loadingMoreRef.current = false',
      'setRecipes([])',
      'setPagination(null)',
      'setError(null)',
      'setMoreError(null)',
      "setPhase('loading')",
    ]) expect(screen).toContain(statement);
    expect(screen).toMatch(/const nextSemanticQuery = String\(value \|\| ''\)\.trim\(\)/);
    expect(screen).toMatch(/if \(nextSemanticQuery === currentSemanticQuery\)/);
    expect(screen).toMatch(/if \(nextSemanticQuery === debouncedSearch\)/);
    expect(screen).toMatch(/const \{ user \} = useAuth\(\)/);
    expect(screen).toMatch(/const ownerKey = String\(user\?\.id \|\| ''\)/);
    expect(screen.match(/if \(!mountedRef\.current \|\| owner !== ownerRef\.current \|\| gen !== genRef\.current\) return/g).length).toBeGreaterThanOrEqual(3);
  });

  it('guards the unmount continuation before isolated local state and exposes no shared effect', () => {
    const awaitIndex = screen.indexOf('const data = await listRecipes(snapshot);');
    const continuationEnd = screen.indexOf('\n    [queryFor, appliedFilters.sort, debouncedSearch, ownerKey]', awaitIndex);
    expect(awaitIndex).toBeGreaterThan(-1);
    expect(continuationEnd).toBeGreaterThan(awaitIndex);
    const continuation = screen.slice(awaitIndex, continuationEnd);
    const mountedGuard = continuation.indexOf(
      'if (!mountedRef.current || owner !== ownerRef.current || gen !== genRef.current) return;'
    );
    expect(mountedGuard).toBeGreaterThan(-1);
    expect(mountedGuard).toBeLessThan(continuation.indexOf('setRecipes(nextRecipes)'));
    expect(continuation).toMatch(
      /if \(mountedRef\.current && owner === ownerRef\.current && gen === genRef\.current\) setRefreshing\(false\)/
    );
    expect(continuation).not.toMatch(
      /navigation\.|recordSearch\(|clearSearchHistory\(|setTimeout\(|loadFirstPage\(|loadMore\(|api\./
    );
    expect(screen).toMatch(
      /return \(\) => \{\s*mountedRef\.current = false;\s*genRef\.current \+= 1;/
    );
  });

  it('suppresses accidental load-more for unsettled queries and expanded filters', () => {
    expect(screen).toMatch(/if \(!filtersOpen && search\.trim\(\) === debouncedSearch\) loadMore\(\)/);
    expect(screen).toMatch(/if \(firstPageGenRef\.current === genRef\.current\) return/);
    expect(screen).toMatch(/if \(loadingMoreRef\.current\) return/);
  });

  it('shares conditional recents and preserves intentional recording only', () => {
    expect(screen).toMatch(/useSearchHistory\(\)/);
    expect(screen).toMatch(/!search\.trim\(\) && recentSearches\.length > 0/);
    expect(screen).toMatch(/onSubmitEditing=\{\(\) => runSearchNow\(search, \{ record: true \}\)\}/);
    expect(screen).toMatch(/runSearchNow\(term, \{ record: true \}\)/);
    expect(screen).toMatch(/if \(search\.trim\(\)\) recordSearch\(search\)/);
    expect(screen).not.toMatch(/onBlur=\{[^}]*recordSearch|onEndEditing=\{[^}]*recordSearch/);
  });

  it('preserves compact real rows, favorites, and Recipe Detail parameters', () => {
    expect(screen).toMatch(/<RecipeImage\b/);
    expect(screen).toMatch(/<FavoriteHeart\b/);
    expect(screen).toMatch(/navigation\.navigate\('RecipeDetail', \{/);
    expect(screen).toMatch(/recipeSource: 'api'/);
  });
});
