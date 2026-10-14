// CollectionDetail — static source validation.
//
// CollectionDetail is the real stack destination Saved's "My Collections"
// grid navigates into (teammate `c1c86ed` CollectionDetailScreen row
// presentation, ported here). It supports two real collection types:
//   - collectionType: 'favorites'                — backed solely by
//     FavoritesContext/the real API (unchanged since the earlier port).
//   - collectionType: 'user', collectionId        — a real user-created
//     collection (M5A), backed by CollectionsContext/collectionService.
// Any other/unknown collectionType renders an honest "isn't available yet".
// The mobile workspace has no RN renderer (see jest.config.js), so these
// invariants are encoded as source assertions.
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

describe('CollectionDetail dispatches on collectionType with no fabricated fallback', () => {
  it('keeps pinned rows and a labelled header across real collection branches', () => {
    expect(raw).toMatch(/accessibilityLabel="Go back"/);
    expect(raw).toMatch(/style=\{styles\.title\} accessibilityRole="header"/);
    expect(raw).toMatch(/accessibilityLabel="Delete collection"/);
    expect(raw).toMatch(/row: \{[\s\S]*?backgroundColor: colors\.creamDeep,[\s\S]*?borderRadius: 14/);
    expect(raw).toMatch(/thumb: \{ width: 60, height: 60, borderRadius: 10/);
    expect(code).toMatch(/collectionService\.getCollection\(collectionId\)/);
  });
  it('imports no mock-data layer or teammate mock/local providers', () => {
    expect(code).not.toMatch(/data\/mockData/);
    expect(code).not.toMatch(/\bmockData\b/);
    expect(code).not.toMatch(/useSavedRecipes|SavedRecipesContext/);
    expect(code).not.toMatch(/collectionRecipes\(/);
  });

  it('never introduces AsyncStorage or any local-only persistence', () => {
    expect(code).not.toMatch(/AsyncStorage/);
    expect(code).not.toMatch(/loadJSON|saveJSON/);
  });

  it('reads collectionType from route.params, defaulting to favorites', () => {
    expect(code).toMatch(/route\?\.params\?\.collectionType \|\| 'favorites'/);
  });

  it('dispatches to Favorites, user, strict smart, and unsupported branches', () => {
    expect(code).toMatch(/function FavoritesCollectionDetail\(/);
    expect(code).toMatch(/function UserCollectionDetail\(/);
    expect(code).toMatch(/function SmartCollectionDetail\(/);
    expect(code).toMatch(/function UnsupportedCollectionDetail\(/);
    expect(code).toMatch(/if \(collectionType === 'favorites'\)/);
    expect(code).toMatch(/if \(collectionType === 'user'\)/);
    expect(code).toMatch(/if \(collectionType === 'smart'\)/);
    expect(code).toMatch(/collectionId=\{route\?\.params\?\.collectionId\}/);
  });

  it('never fabricates a recipe list of its own for an unsupported collection', () => {
    expect(code).not.toMatch(/const\s+(recipes|RECIPES|COLLECTIONS)\s*=\s*\[/);
    expect(code).toMatch(/isn.t available yet/);
  });

  it('carries no client/provider secrets or token material', () => {
    expect(code).not.toMatch(/clientId|CLIENT_ID|apiKey|API_KEY|secret|Bearer /i);
  });

  it('does not render cuisine or vibe', () => {
    expect(code).not.toMatch(/cuisine/i);
    expect(code).not.toMatch(/\bvibe\b/i);
  });

  it('observes AuthContext identity for smart ownership but holds no token material', () => {
    expect(code).not.toMatch(/SecureStore|expo-secure-store|tokenStore/);
    expect(code).not.toMatch(/accessToken|refreshToken|idToken/);
    expect(raw).toMatch(/import \{ useAuth \} from '\.\.\/context\/AuthContext'/);
  });

  it('never replaces or resets into MainTabs', () => {
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/MainTabs/);
  });
});

describe('CollectionDetail smart branch owns strict paginated race-safe state', () => {
  const start = code.indexOf('function SmartCollectionDetail');
  const end = code.indexOf('function UnsupportedCollectionDetail', start);
  const smart = code.slice(start, end);

  it('requests only group key plus page/limit and has no client predicates', () => {
    expect(smart).toMatch(/getSmartCollection\(requestGroupKey,\s*\{\s*page: 1,\s*limit: SMART_COLLECTION_PAGE_LIMIT/);
    expect(smart).toMatch(/page: targetPage/);
    expect(smart).not.toMatch(/caloriesKcal|proteinGrams|fiberGrams|sugarGrams|category ===|dietaryTags/);
  });

  it('guards every operation by mount, account, group, session, generation, and operation token', () => {
    expect(smart).toMatch(/!mountedRef\.current/);
    expect(smart).toMatch(/session !== sessionRef\.current/);
    expect(smart).toMatch(/generation !== generationRef\.current/);
    expect(smart).toMatch(/requestOwnerId !== authUserIdRef\.current/);
    expect(smart).toMatch(/requestGroupKey !== groupKeyRef\.current/);
    expect(smart).toMatch(/pageOneToken !== pageOneTokenRef\.current/);
    expect(smart).toMatch(/token !== moreTokenRef\.current/);
  });

  it('supports initial loading/error/retry, strict empty, retained refresh, and load-more retry', () => {
    expect(smart).toMatch(/status === 'loading'/);
    expect(smart).toMatch(/status === 'error'/);
    expect(smart).toMatch(/Retry loading smart collection/);
    expect(smart).toMatch(/No recipes in this smart collection yet\./);
    expect(smart).toMatch(/retainRows: true/);
    expect(smart).toMatch(/Retry loading more recipes/);
  });

  it('deduplicates appended recipe ids and never renders membership controls', () => {
    expect(smart).toMatch(/new Set\(recipesRef\.current\.map\(\(\{ id \}\) => id\)\)/);
    expect(smart).not.toMatch(/FavoriteHeart|removeRecipeFromCollection|trash-outline/);
    expect(smart).toMatch(/recipeId: recipe\.id/);
    expect(smart).toMatch(/initialRecipe: recipe/);
  });
});

describe('CollectionDetail Favorites branch keeps real, unchanged behavior', () => {
  it('fetches favorites from the real FavoritesContext only, reloading on focus', () => {
    expect(raw).toMatch(/import \{ useFavorites \} from '\.\.\/context\/FavoritesContext'/);
    expect(code).toMatch(/useFavorites\(\)/);
    expect(code).toMatch(/useFocusEffect\(/);
  });

  it('renders recipe photography from the backend imageUrl only', () => {
    expect(raw).toMatch(/import RecipeImage from '\.\.\/components\/RecipeImage'/);
    expect(code).toMatch(/source=\{entry\.recipe\.imageUrl\}/);
    expect(code).not.toMatch(/https?:\/\//);
    expect(code).not.toMatch(/unsplash|picsum|pravatar|gmanews/i);
  });

  it('opens RecipeDetail with the real API param shape, including initialRecipe', () => {
    expect(code).toMatch(/navigation\.navigate\('RecipeDetail',\s*\{/);
    expect(code).toMatch(/recipeSource: 'api'/);
    expect(code).toMatch(/recipeId: recipe\.id/);
    expect(code).toMatch(/initialRecipe: recipe/);
    expect(code).not.toMatch(/navigate\('RecipeDetail',\s*\{\s*recipe\s*\}/);
  });

  it('the empty-state CTA points at the real Discover route', () => {
    expect(code).toMatch(/onPress=\{\(\) => navigation\.navigate\('Discover'\)\}/);
  });

  it('uses the real FavoriteHeart control for removal, not a fake collection toggle', () => {
    expect(raw).toMatch(/import FavoriteHeart from '\.\.\/components\/FavoriteHeart'/);
    expect(code).toMatch(/<FavoriteHeart\b/);
    expect(code).not.toMatch(/toggleInCollection/);
  });

  it('shows a spinner while loading, a real error+Retry, and an honest empty message', () => {
    expect(code).toMatch(/status === 'loading' \|\| status === 'idle'/);
    expect(code).toMatch(/<ActivityIndicator/);
    expect(code).toMatch(/status === 'error'/);
    expect(code).toMatch(/Nothing here yet\./);
  });
});

describe('CollectionDetail user-collection branch (M5A) uses only real backend data', () => {
  it('fetches collection metadata and paginated recipes via collectionService, never a mock', () => {
    expect(raw).toMatch(/import \* as collectionService from '\.\.\/api\/collectionService'/);
    expect(code).toMatch(/collectionService\.getCollection\(collectionId\)/);
    expect(code).toMatch(/collectionService\.listCollectionRecipes\(collectionId,/);
  });

  it('uses CollectionsContext for delete + remove-membership mutations, keeping Saved in sync', () => {
    expect(raw).toMatch(/import \{ useCollections \} from '\.\.\/context\/CollectionsContext'/);
    expect(code).toMatch(/deleteCollection, removeRecipeFromCollection \} = useCollections\(\)/);
  });

  it('removing a recipe from a user collection never calls Favorites remove/toggle', () => {
    const fnStart = code.indexOf('const removeRecipe = async');
    const fnEnd = code.indexOf('\n  };', fnStart);
    const fn = code.slice(fnStart, fnEnd);
    expect(fn).toMatch(/removeRecipeFromCollection\(collectionId, recipeId\)/);
    expect(fn).not.toMatch(/toggleFavorite|removeFavorite|FavoriteHeart/);
  });

  it('deleting a collection requires confirmation before calling the real delete', () => {
    expect(code).toMatch(/const confirmDelete = \(\) => \{/);
    expect(code).toMatch(/Alert\.alert\('Delete collection'/);
    expect(code).toMatch(/style: 'destructive'/);
    expect(code).toMatch(/await deleteCollection\(collectionId\)/);
  });

  it('opens RecipeDetail with the real API param shape, including initialRecipe', () => {
    const fnStart = code.indexOf('function UserCollectionDetail');
    const fnEnd = code.indexOf('function UnsupportedCollectionDetail');
    const fn = code.slice(fnStart, fnEnd);
    expect(fn).toMatch(/recipeSource: 'api'/);
    expect(fn).toMatch(/recipeId: recipe\.id/);
    expect(fn).toMatch(/initialRecipe: recipe/);
  });

  it('shows the real empty-collection copy, a real trash-to-delete header action, and no fabricated cover', () => {
    expect(code).toMatch(/Add recipes from any recipe page\./);
    expect(code).toMatch(/trash-outline/);
  });

  it('shows a real loading spinner and a real error+Retry, never a fabricated list', () => {
    const fnStart = code.indexOf('function UserCollectionDetail');
    const fnEnd = code.indexOf('function UnsupportedCollectionDetail');
    const fn = code.slice(fnStart, fnEnd);
    expect(fn).toMatch(/<ActivityIndicator/);
    expect(fn).toMatch(/status === 'error'/);
    expect(fn).toMatch(/Retry/);
  });

  it('never introduces AsyncStorage or a mock recipe list for the user-collection branch', () => {
    const fnStart = code.indexOf('function UserCollectionDetail');
    const fnEnd = code.indexOf('function UnsupportedCollectionDetail');
    const fn = code.slice(fnStart, fnEnd);
    expect(fn).not.toMatch(/AsyncStorage/);
    expect(fn).not.toMatch(/const\s+(recipes|RECIPES)\s*=\s*\[/);
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
