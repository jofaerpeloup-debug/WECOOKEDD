const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../src/screens/DashboardScreen.js'), 'utf8');
const topBar = fs.readFileSync(path.join(__dirname, '../src/components/TopBar.js'), 'utf8');

describe('Dashboard production authority and shared recent searches', () => {
  it('keeps the pinned hero and search hierarchy with accessible API recipe actions', () => {
    expect(source).toMatch(/height: 190/);
    expect(source).toMatch(/borderRadius: 20/);
    expect(source).toMatch(/accessibilityLabel=\{`Open \$\{feature\.title\}`\}/);
    expect(source).toMatch(/accessibilityLabel=\{`Browse \$\{shortcut\.label\} recipes`\}/);
    expect(source).toMatch(/accessibilityLabel="Retry loading recipes"/);
  });
  it('uses a Home-only left wordmark and a graded hero scrim', () => {
    expect(source).toMatch(/mode="brand"\s+variant="home"\s+transparent/);
    expect(topBar).toMatch(/brandRowLeft: \{ justifyContent: 'flex-start' \}/);
    expect(topBar).toMatch(/fontFamily: typography\.display\.fontFamilyItalic, fontSize: 22/);
    expect(topBar).toMatch(/transparent && \{ backgroundColor: 'transparent', borderBottomWidth: 0 \}/);
    expect(source).toMatch(/<SvgLinearGradient id="dashboardHeroScrim"/);
    expect(source).toMatch(/<Stop offset="0%" stopColor="#12160e" stopOpacity=\{0\}/);
    expect(source).toMatch(/<Stop offset="100%" stopColor="#12160e" stopOpacity=\{0\.92\}/);
    expect(source).not.toMatch(/backgroundColor: 'rgba\(18,22,14,0\.42\)'/);
  });
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

  it('uses only canonical category cards without unapproved production images', () => {
    expect(source).toMatch(/RECIPE_CATEGORIES\.map\(\(key\) => \(\{/);
    expect(source).toMatch(/label: categoryLabel\(key\)/);
    expect(source).toMatch(/navigation\.navigate\('Discover', \{ initialCategory: category \}\)/);
    expect(source).toMatch(/onPress=\{\(\) => openCategory\(''\)\}/);
    expect(source).not.toMatch(/<Text[^>]*>(?:Vibe|Cuisine)<\/Text>|browseKeys|https?:\/\/[^'"`]*\.(?:jpg|png|webp)/i);
  });

  it('consumes only the existing Shopping provider and derives a ready unchecked-entry count', () => {
    expect(source).toMatch(/import \{ useShoppingList \} from '\.\.\/context\/ShoppingListContext'/);
    expect(source).toMatch(/items: shoppingItems, status: shoppingStatus/);
    expect(source).toMatch(/shoppingStatus === 'ready'/);
    expect(source).toMatch(/shoppingItems\.reduce\(\(count, item\) => count \+ \(item\.isChecked \? 0 : 1\), 0\)/);
    expect(source).not.toMatch(/shoppingListService|AsyncStorage|loadJSON|saveJSON/);
    expect(source).not.toMatch(/useState\([^)]*shopping|setShopping|useEffect\([^]*shoppingListService/);
  });

  it('opts only Dashboard into one caller-owned List navigation action', () => {
    expect(source).toMatch(/onShoppingPress=\{\(\) => navigation\.navigate\('List'\)\}/);
    expect(source).toMatch(/shoppingCount=\{uncheckedShoppingCount\}/);
    expect(topBar).not.toMatch(/navigate\('List'\)|route\.name|useRoute\(/);
  });

  it('keeps shared TopBar Shopping support explicit, capped only visually, and hidden by default', () => {
    expect(topBar).toMatch(/onShoppingPress,/);
    expect(topBar).toMatch(/\{onShoppingPress && \(/);
    expect(topBar).toMatch(/shoppingCount >= 100 \? '99\+' : shoppingCount/);
    expect(topBar).toMatch(/Shopping list, \$\{shoppingCount\} unchecked/);
    expect(topBar).toMatch(/accessibilityElementsHidden/);
    expect(topBar).toMatch(/importantForAccessibility="no-hide-descendants"/);
  });

  it('introduces no Shopping request, storage, mutation, backend, or async owner', () => {
    const combined = `${source}\n${topBar}`;
    expect(combined).not.toMatch(/getShoppingList|reloadShopping|addItem|setChecked|removeItem|clearItems/);
    expect(combined).not.toMatch(/shoppingListService|AsyncStorage|SecureStore/);
    expect(combined).not.toMatch(/shoppingGen|shoppingLoading|shoppingError|setShopping/);
  });

  it('adds only the server-authoritative six-item Top Rated Trending prefix', () => {
    expect(source).toMatch(/listRecipes\(\{\s*sort: 'topRated', page: 1, limit: TRENDING_LIMIT/);
    expect(source).toMatch(/const TRENDING_LIMIT = 6/);
    expect(source).toMatch(/trending\.map\(renderTrendingCard\)/);
    expect(source).toMatch(/recipe\.ratingSummary\.averageRating/);
    expect(source).toMatch(/recipe\.ratingSummary\.ratingCount/);
    expect(source).toMatch(/navigation\.navigate\('Trending'\)/);
    expect(source).not.toMatch(/trending\.sort\(|mockTrending|trendingScore|popularity|AsyncStorage/);
  });
});
