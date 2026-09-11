// CollectionDetail — static source validation.
//
// CollectionDetail is the real stack destination Saved's "My Collections"
// grid navigates into (teammate `c1c86ed` CollectionDetailScreen row
// presentation, ported here). It supports exactly ONE real system collection
// — `route.params.collectionType === 'favorites'` — backed solely by
// FavoritesContext/the real API. Teammate's smart/user collections have no
// WeCooked backend (Collections proper is M5). The mobile workspace has no RN
// renderer (see jest.config.js), so these invariants are encoded as source
// assertions.
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

const raw = read('screens/CollectionDetailScreen.js');
const code = stripComments(raw);

describe('CollectionDetail keeps real Favorites as the only data source', () => {
  it('imports no mock-data layer or teammate mock/local providers', () => {
    expect(code).not.toMatch(/data\/mockData/);
    expect(code).not.toMatch(/\bmockData\b/);
    expect(code).not.toMatch(/useSavedRecipes|SavedRecipesContext/);
    expect(code).not.toMatch(/useCollections|CollectionsContext|CollectionsProvider/);
    expect(code).not.toMatch(/collectionRecipes\(/);
  });

  it('never introduces AsyncStorage or any local-only persistence', () => {
    expect(code).not.toMatch(/AsyncStorage/);
    expect(code).not.toMatch(/loadJSON|saveJSON/);
  });

  it('reads collectionType from route.params and supports favorites', () => {
    expect(code).toMatch(/route\?\.params\?\.collectionType \|\| 'favorites'/);
    expect(code).toMatch(/const supported = collectionType === 'favorites'/);
  });

  it('never fabricates a recipe list of its own for an unsupported collection', () => {
    expect(code).not.toMatch(/const\s+(recipes|RECIPES|COLLECTIONS)\s*=\s*\[/);
    // The unsupported branch shows an honest message, not fake content.
    expect(code).toMatch(/isn.t available yet/);
  });

  it('fetches favorites from the real FavoritesContext only, reloading on focus', () => {
    expect(raw).toMatch(/import \{ useFavorites \} from '\.\.\/context\/FavoritesContext'/);
    expect(code).toMatch(/useFavorites\(\)/);
    expect(code).toMatch(/useFocusEffect\(/);
    expect(code).toMatch(/if \(supported\) reload\(\);/);
  });

  it('renders recipe photography from the backend imageUrl only', () => {
    expect(raw).toMatch(/import RecipeImage from '\.\.\/components\/RecipeImage'/);
    expect(code).toMatch(/source=\{entry\.recipe\.imageUrl\}/);
    expect(code).not.toMatch(/https?:\/\//);
    expect(code).not.toMatch(/unsplash|picsum|pravatar|gmanews/i);
    expect(code).not.toMatch(/\{\s*uri:\s*require\(/);
    expect(code).not.toMatch(/\brequire\(/);
  });

  it('does not render cuisine or vibe', () => {
    expect(code).not.toMatch(/cuisine/i);
    expect(code).not.toMatch(/\bvibe\b/i);
  });

  it('carries no client/provider secrets or token material', () => {
    expect(code).not.toMatch(/clientId|CLIENT_ID|apiKey|API_KEY|secret|Bearer /i);
  });
});

describe('CollectionDetail uses the real navigation contract and real remove behavior', () => {
  it('goes back via navigation.goBack() — real stack pop, no local pseudo-route', () => {
    expect(code).toMatch(/navigation\.goBack\(\)/);
  });

  it('opens RecipeDetail with the real API param shape, including initialRecipe', () => {
    expect(code).toMatch(/navigation\.navigate\('RecipeDetail',\s*\{/);
    expect(code).toMatch(/recipeSource: 'api'/);
    expect(code).toMatch(/recipeId: recipe\.id/);
    expect(code).toMatch(/initialRecipe: recipe/);
    expect(code).not.toMatch(/navigate\('RecipeDetail',\s*\{\s*recipe\s*\}/);
  });

  it('never replaces or resets into MainTabs', () => {
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/MainTabs/);
  });

  it('the empty-state CTA points at the real Discover route', () => {
    expect(code).toMatch(/onPress=\{\(\) => navigation\.navigate\('Discover'\)\}/);
  });

  it('uses the real FavoriteHeart control for removal, not a fake collection toggle', () => {
    expect(raw).toMatch(/import FavoriteHeart from '\.\.\/components\/FavoriteHeart'/);
    expect(code).toMatch(/<FavoriteHeart\b/);
    expect(code).not.toMatch(/toggleInCollection/);
  });

  it('the favorite control is a sibling of the row press target, not nested inside it', () => {
    const rowBlock = code.match(/<Pressable style=\{styles\.rowMain\}[\s\S]*?<\/Pressable>\s*<FavoriteHeart\b/);
    expect(rowBlock).not.toBeNull();
  });

  it('holds no authentication, session, or token state of its own', () => {
    expect(code).not.toMatch(/SecureStore|expo-secure-store|tokenStore/);
    expect(code).not.toMatch(/accessToken|refreshToken|idToken/);
    expect(code).not.toMatch(/useAuth\(/);
  });
});

describe('CollectionDetail loading / error / empty states are honest', () => {
  it('shows a spinner while loading, not a fabricated list', () => {
    expect(code).toMatch(/status === 'loading' \|\| status === 'idle'/);
    expect(code).toMatch(/<ActivityIndicator/);
  });

  it('shows a real error message with Retry, never silently falls back', () => {
    expect(code).toMatch(/status === 'error'/);
    expect(code).toMatch(/Retry/);
    expect(code).toMatch(/onPress=\{\(\) => reload\(\)\}/);
  });

  it('shows an honest empty message when there are zero favorites', () => {
    expect(code).toMatch(/Nothing here yet\./);
  });
});

describe('CollectionDetail is registered exactly once in the root stack', () => {
  const rootNavRaw = read('navigation/RootNavigator.js');
  const rootNav = stripComments(rootNavRaw);

  it('RootNavigator registers CollectionDetail -> CollectionDetailScreen exactly once', () => {
    const matches = [...rootNav.matchAll(/<Stack\.Screen\s+name="CollectionDetail"/g)];
    expect(matches).toHaveLength(1);
    expect(rootNav).toMatch(/name="CollectionDetail"\s+component=\{CollectionDetailScreen\}/);
  });

  it('is not registered as a MainTabs route', () => {
    const mainTabs = stripComments(read('navigation/MainTabs.js'));
    expect(mainTabs).not.toMatch(/CollectionDetail/);
  });
});
