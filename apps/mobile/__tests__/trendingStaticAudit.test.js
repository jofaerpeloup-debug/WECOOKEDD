const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../src/screens/TrendingScreen.js'), 'utf8');

describe('MOBILE-RANK1 Trending static contract', () => {
  it('uses only paginated topRated server reads and never computes rank', () => {
    expect(source).toMatch(/listRecipes\(\{ sort: 'topRated', page: 1, limit: PAGE_LIMIT \}\)/);
    expect(source).toMatch(/listRecipes\(\{ sort: 'topRated', page: nextPage, limit: PAGE_LIMIT \}\)/);
    expect(source).not.toMatch(/\.sort\(|trendingScore|popularity|viewCount|mockData|AsyncStorage/);
  });

  it('keeps replacement, continuation, account, and unmount ownership guards', () => {
    expect(source).toMatch(/generationRef/);
    expect(source).toMatch(/firstPageRef/);
    expect(source).toMatch(/loadingMoreRef/);
    expect(source).toMatch(/owner !== ownerRef\.current/);
    expect(source).toMatch(/mountedRef\.current/);
  });

  it('shows authoritative summaries and exact API Recipe Detail navigation', () => {
    expect(source).toMatch(/item\.ratingSummary\.averageRating/);
    expect(source).toMatch(/item\.ratingSummary\.ratingCount/);
    expect(source).toMatch(/recipeSource: 'api'/);
    expect(source).toMatch(/recipeId: recipe\.id/);
  });

  it('keeps loading, empty, retry, refresh, and load-more states distinct', () => {
    expect(source).toMatch(/Loading Trending Meals/);
    expect(source).toMatch(/No rated recipes yet/);
    expect(source).toMatch(/Retry Trending Meals/);
    expect(source).toMatch(/RefreshControl/);
    expect(source).toMatch(/Retry loading more Trending Meals/);
  });
});
