const fs = require('fs');
const path = require('path');

const screen = fs.readFileSync(path.join(__dirname, '../src/screens/DiscoverScreen.js'), 'utf8');
const panel = fs.readFileSync(path.join(__dirname, '../src/components/DiscoverFiltersSheet.js'), 'utf8');
const executableScreen = screen
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('MOBILE-DISC5 Search shell static contract', () => {
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

  it('keeps exactly the six supported sorts visible outside narrowing filters', () => {
    expect(screen).toMatch(/DISCOVER_SORT_OPTIONS\.map/);
    expect(screen).toMatch(/accessibilityLabel=\{`Sort: \$\{option\.label\}`\}/);
    expect(panel).not.toMatch(/DISCOVER_SORT_OPTIONS|label="Sort"/);
    expect(screen).not.toMatch(/rating|popularity|relevance|Trending|Top Rated|For You/);
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
    expect(screen.match(/if \(!mountedRef\.current \|\| gen !== genRef\.current\) return/g).length).toBeGreaterThanOrEqual(3);
  });

  it('guards the unmount continuation before isolated local state and exposes no shared effect', () => {
    const awaitIndex = screen.indexOf('const data = await listRecipes(snapshot);');
    const continuationEnd = screen.indexOf('\n    [queryFor]', awaitIndex);
    expect(awaitIndex).toBeGreaterThan(-1);
    expect(continuationEnd).toBeGreaterThan(awaitIndex);
    const continuation = screen.slice(awaitIndex, continuationEnd);
    const mountedGuard = continuation.indexOf(
      'if (!mountedRef.current || gen !== genRef.current) return;'
    );
    expect(mountedGuard).toBeGreaterThan(-1);
    expect(mountedGuard).toBeLessThan(continuation.indexOf('setRecipes(nextRecipes)'));
    expect(continuation).toMatch(
      /if \(mountedRef\.current && gen === genRef\.current\) setRefreshing\(false\)/
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
