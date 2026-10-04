const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../src/screens/DashboardScreen.js'), 'utf8');

describe('Dashboard production authority and shared recent searches', () => {
  it('keeps real Recipe service, image, favorites, and Recipe Detail navigation', () => {
    expect(source).toMatch(/import \{ listRecipes \} from '\.\.\/api\/recipeService'/);
    expect(source).toMatch(/<RecipeImage\b/);
    expect(source).toMatch(/<FavoriteHeart\b/);
    expect(source).toMatch(/navigation\.navigate\('RecipeDetail', \{/);
    expect(source).toMatch(/recipeSource: 'api'/);
  });

  it('consumes the single shared history provider and owns no storage writer', () => {
    expect(source).toMatch(/useSearchHistory\(\)/);
    expect(source).toMatch(/recentSearches: recent/);
    expect(source).toMatch(/recordSearch/);
    expect(source).toMatch(/clearSearchHistory/);
    expect(source).not.toMatch(/loadJSON|saveJSON|removeItem|AsyncStorage|RECENT_SEARCH_KEY/);
  });

  it('records only keyboard submission, recent selection, and result opening', () => {
    expect(source).toMatch(/onSubmitEditing=\{\(\) => recordSearch\(trimmed\)\}/);
    expect(source).toMatch(/setQuery\(term\);\s*recordSearch\(term\)/);
    expect(source).toMatch(/if \(searching\) recordSearch\(trimmed\)/);
    expect(source).not.toMatch(/onBlur=\{[^}]*recordSearch|onEndEditing=\{[^}]*recordSearch/);
  });

  it('retains immediate query invalidation and authenticated API search', () => {
    expect(source).toMatch(/searchGenRef\.current \+= 1/);
    expect(source).toMatch(/listRecipes\(\{ search: trimmed, page: 1, limit: SEARCH_LIMIT \}\)/);
    expect(source).toMatch(/gen !== searchGenRef\.current/);
  });

  it('retains the exact Dashboard to Search preset handoff', () => {
    expect(source).toMatch(/navigation\.navigate\('Discover', \{ initialFilter: filterKey \|\| 'all' \}\)/);
  });
});
