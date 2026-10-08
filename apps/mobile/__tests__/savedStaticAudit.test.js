// Saved final-frontend port — static source validation.
//
// Saved is the pinned teammate "My Collections" grid/header shell (bae924b) —
// a collections BROWSER. It shows the real system collection "Favorites"
// first, followed by the five server-defined smart collections, then
// the user's real, backend-persisted Collections (M5A — CollectionsContext/
// collectionService/collection.routes.js). There are no client predicates or
// AsyncStorage-backed local collections. The mobile
// workspace has no RN renderer (see jest.config.js), so these invariants are
// encoded as source assertions.
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

const raw = read('screens/SavedScreen.js');
const code = stripComments(raw);
const screenStart = code.indexOf('export default function SavedScreen');
const screenEnd = code.indexOf('function makeStyles');
if (screenStart === -1 || screenEnd === -1 || screenEnd <= screenStart) {
  throw new Error('savedStaticAudit: could not locate the SavedScreen source slice');
}
const savedCode = code.slice(screenStart, screenEnd);
const createStart = savedCode.indexOf('const create = async () => {');
const createEnd = savedCode.indexOf('\n  const favoritesCover', createStart);
if (createStart === -1 || createEnd === -1 || createEnd <= createStart) {
  throw new Error('savedStaticAudit: could not locate the collection create handler');
}
const createCode = savedCode.slice(createStart, createEnd);
const createControlStyle = savedCode.indexOf('style={styles.createBtn}');
const createControlStart = savedCode.lastIndexOf('<Pressable', createControlStyle);
const createControlEnd = savedCode.indexOf('</Pressable>', createControlStart);
if (createControlStyle === -1 || createControlStart === -1 || createControlEnd === -1 || createControlEnd <= createControlStart) {
  throw new Error('savedStaticAudit: could not locate the collection create control');
}
const createControlCode = savedCode.slice(createControlStart, createControlEnd);

describe('Saved keeps Favorites, smart collections, and user Collections server-authoritative', () => {
  it('imports no mock-data layer or teammate mock/local providers', () => {
    expect(code).not.toMatch(/data\/mockData/);
    expect(code).not.toMatch(/\bmockData\b/);
    expect(code).not.toMatch(/useSavedRecipes|SavedRecipesContext/);
    expect(code).not.toMatch(/collectionRecipes\(/);
  });

  it('never introduces AsyncStorage or any local-only persistence', () => {
    expect(code).not.toMatch(/AsyncStorage/);
    expect(code).not.toMatch(/loadJSON|saveJSON/);
    expect(code).not.toMatch(/wecooked:userCollections/);
  });

  it('fetches favorites from the real FavoritesContext only', () => {
    expect(raw).toMatch(/import \{ useFavorites \} from '\.\.\/context\/FavoritesContext'/);
    expect(code).toMatch(/useFavorites\(\)/);
  });

  it('fetches collections from the real CollectionsContext only', () => {
    expect(raw).toMatch(/import \{ useCollections \} from '\.\.\/context\/CollectionsContext'/);
    expect(code).toMatch(/useCollections\(\)/);
    expect(code).toMatch(/reloadCollections/);
  });

  it('reloads Favorites, Collections, and smart cards on focus', () => {
    expect(code).toMatch(/useFocusEffect\(/);
    expect(code).toMatch(/reloadFavorites\(\)/);
    expect(code).toMatch(/reloadCollections\(\)/);
    expect(code).toMatch(/reloadSmartCollections\(\)/);
  });

  it('uses the pinned two-column FlatList and waits for all three independent sources on pull', () => {
    expect(raw).toMatch(/import \{[^}]*FlatList[^}]*\} from 'react-native'/);
    expect(savedCode).toMatch(/<FlatList/);
    expect(savedCode).toMatch(/numColumns=\{2\}/);
    expect(savedCode).toMatch(/onRefresh=\{refreshAll\}/);
    expect(savedCode).toMatch(/await Promise\.all\(\[reloadFavorites\(\), reloadCollections\(\), reloadSmartCollections\(\)\]\)/);
  });

  it('keeps both real load failures visible and retries only their failed source', () => {
    expect(savedCode).toMatch(/error: favoritesError/);
    expect(savedCode).toMatch(/error: collectionsError/);
    expect(savedCode).not.toMatch(/favoritesError \|\| collectionsError/);
    expect(savedCode).toMatch(/\{favoritesError \? \([\s\S]*?onPress=\{reloadFavorites\}[\s\S]*?Favorites: \{favoritesError\}/);
    expect(savedCode).toMatch(/\{collectionsError \? \([\s\S]*?onPress=\{reloadCollections\}[\s\S]*?Collections: \{collectionsError\}/);
  });

  it('never duplicates smart predicates or fabricates a recipe list of its own', () => {
    expect(code).not.toMatch(/Quick Meals|Healthy Meals|Weekend Cooking|Dinner Ideas|\bBreakfast\b/);
    expect(code).not.toMatch(/const\s+(recipes|RECIPES|COLLECTIONS)\s*=\s*\[/);
    expect(code).not.toMatch(/caloriesKcal|proteinGrams|fiberGrams|sugarGrams|prepTimeMinutes|cookTimeMinutes/);
  });

  it('renders card covers from backend imageUrl / coverImageUrls only', () => {
    expect(raw).toMatch(/import RecipeImage from '\.\.\/components\/RecipeImage'/);
    expect(code).toMatch(/source=\{(favoritesCover\[0\]|entry)\.recipe\.imageUrl\}/);
    expect(code).toMatch(/covers\[0\]/);
    expect(code).not.toMatch(/https?:\/\//);
    expect(code).not.toMatch(/unsplash|picsum|pravatar|gmanews/i);
    expect(code).not.toMatch(/\{\s*uri:\s*require\(/);
    expect(code).not.toMatch(/\brequire\(/);
  });

  it('renders real collection counts from recipeCount, never a fabricated count', () => {
    expect(savedCode).toMatch(/\.\.\.collection, type: 'user'/);
    expect(savedCode).toMatch(/item\.recipeCount/);
  });

  it('does not render cuisine or vibe', () => {
    expect(code).not.toMatch(/cuisine/i);
    expect(code).not.toMatch(/\bvibe\b/i);
  });

  it('carries no client/provider secrets or token material', () => {
    expect(code).not.toMatch(/clientId|CLIENT_ID|apiKey|API_KEY|secret|Bearer /i);
  });
});

describe('Saved is only the collections-browser shell — no nested Favorites view', () => {
  it('holds no in-screen view/pseudo-route state', () => {
    expect(code).not.toMatch(/useState\('collections'\)/);
    expect(code).not.toMatch(/setView\(/);
    expect(code).not.toMatch(/view === 'favorites'/);
  });

  it('never imports BackHandler — no manual back workaround for a nested view', () => {
    expect(code).not.toMatch(/BackHandler/);
  });

  it('never renders Favorites recipe rows, FavoriteHeart, or a Discover-CTA empty state itself', () => {
    // That presentation now lives entirely in CollectionDetailScreen.
    expect(code).not.toMatch(/<FavoriteHeart\b/);
    expect(code).not.toMatch(/styles\.rowMain/);
    expect(raw).not.toMatch(/import FavoriteHeart/);
    expect(raw).not.toMatch(/import Button from/);
  });

  it('the Favorites card navigates to the real CollectionDetail route with collectionType, not a fake array', () => {
    expect(code).toMatch(
      /navigation\.navigate\('CollectionDetail',\s*\{\s*collectionType:\s*'favorites'\s*\}\)/
    );
    expect(code).not.toMatch(/collectionType:\s*'favorites'[\s\S]{0,40}(recipes|favorites):\s*\[/);
  });

  it('a real collection card navigates to CollectionDetail with collectionType "user" and a real collectionId, not a fabricated one', () => {
    expect(code).toMatch(
      /navigation\.navigate\('CollectionDetail',\s*\{\s*collectionType:\s*'user',\s*collectionId\s*\}\)/
    );
    expect(code).not.toMatch(/collectionType:\s*'user'[\s\S]{0,80}(recipes):\s*\[/);
  });

  it('a smart card navigates with only its immutable key', () => {
    expect(code).toMatch(/navigation\.navigate\('CollectionDetail',\s*\{\s*collectionType:\s*'smart',\s*groupKey\s*\}\)/);
    expect(code).not.toMatch(/collectionType:\s*'smart'[\s\S]{0,100}(predicate|recipes|recipeCount|coverImageUrls):/);
  });
});

describe('Saved stays a stack destination with the real navigation contract', () => {
  it('never replaces or resets into MainTabs, and does not modify the nav shell', () => {
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/MainTabs/);
  });

  it('goes back via navigation.goBack(), never re-adds a Saved tab', () => {
    expect(code).toMatch(/navigation\.goBack\(\)/);
  });

  it('navigates only to CollectionDetail and List — no other destinations', () => {
    const targets = [...code.matchAll(/navigation\.navigate\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]);
    expect(targets).toEqual(expect.arrayContaining(['CollectionDetail', 'List']));
    for (const t of targets) expect(['CollectionDetail', 'List']).toContain(t);
  });

  it('observes AuthContext identity only for stale-response ownership and holds no token material', () => {
    expect(code).not.toMatch(/SecureStore|expo-secure-store|tokenStore/);
    expect(code).not.toMatch(/accessToken|refreshToken|idToken/);
    expect(raw).toMatch(/import \{ useAuth \} from '\.\.\/context\/AuthContext'/);
    expect(code).toMatch(/ownerId !== authUserIdRef\.current/);
    expect(code).toMatch(/generation !== smartGenerationRef\.current/);
    expect(code).toMatch(/!mountedRef\.current/);
  });
});

describe('Saved smart-card states are independent and honest', () => {
  it('uses strict smart service data, stable placeholder positions, and no count while unavailable', () => {
    expect(raw).toMatch(/listSmartCollections/);
    expect(code).toMatch(/SMART_COLLECTION_DEFINITIONS\.map/);
    expect(code).toMatch(/item\.recipeCount == null/);
    expect(code).toMatch(/disabled=\{item\.type === 'smart'/);
  });

  it('retains independent smart errors with an accessible retry', () => {
    expect(code).toMatch(/Smart collections: \{smartError\} Tap to retry\./);
    expect(code).toMatch(/onPress=\{reloadSmartCollections\}/);
    expect(code).not.toMatch(/favoritesError \|\| collectionsError \|\| smartError/);
  });
});

describe('collection creation is real, not a fake/pending placeholder', () => {
  it('the "+" control opens a real inline create form, not an honest-unavailable alert', () => {
    expect(code).not.toMatch(/collectionsUnavailable/);
    expect(code).not.toMatch(/Collections are coming soon/);
    expect(code).toMatch(/setAdding/);
    expect(code).toMatch(/<TextInput/);
  });

  it('submitting calls the real CollectionsContext createCollection, never local/optimistic-only state', () => {
    expect(createCode).toMatch(/const trimmed = name\.trim\(\)/);
    expect(createCode).toMatch(/if \(!trimmed \|\| creating \|\| createPendingRef\.current\) return/);
    expect(createCode).toMatch(/createPendingRef\.current = true/);
    expect(createCode).toMatch(/await createCollection\(\{ name: trimmed \}\)/);
    expect(createCode).toMatch(/finally \{\s*createPendingRef\.current = false;\s*setCreating\(false\)/);
    expect(createCode).not.toMatch(/createCollection\(\{ name \}\)/);
    expect(createCode).not.toMatch(/setCollections|setCards|setFavorites/);
  });

  it('a backend create failure is shown honestly, not silently swallowed', () => {
    expect(createCode).toMatch(/setCreateError/);
    expect(createCode).toMatch(/result\.error/);
  });

  it('a successful create clears the form instead of leaving fake local rows behind', () => {
    expect(createCode).toMatch(/if \(result\.ok\) \{/);
    expect(createCode).toMatch(/setName\(''\)/);
    expect(createCode).toMatch(/setAdding\(false\)/);
  });

  it('disables duplicate or blank submissions with matching accessibility state', () => {
    expect(createControlCode).toMatch(/onPress=\{create\}/);
    expect(createControlCode).toMatch(/disabled=\{creating \|\| !name\.trim\(\)\}/);
    expect(createControlCode).toMatch(
      /accessibilityState=\{\{ disabled: creating \|\| !name\.trim\(\) \}\}/
    );
  });
});
