// Saved final-frontend port — static source validation.
//
// Saved is ONLY the teammate "My Collections" grid/header shell (commit
// c1c86ed) — a collections BROWSER, not a favorites list. The teammate
// screen's 5 hardcoded "smart" collections (scanning the whole mock recipe
// catalog) and AsyncStorage-backed user collections have no WeCooked backend
// (Collections proper is M5), so only ONE real system collection is shown:
// "Favorites", backed exclusively by FavoritesContext/the real API. Tapping
// it navigates to the real `CollectionDetail` stack route (own file, own
// test) — Saved holds no in-screen pseudo-route/BackHandler workaround of its
// own; back/edge-swipe between Saved and CollectionDetail is plain React
// Navigation stack behavior. The mobile workspace has no RN renderer (see
// jest.config.js), so these invariants are encoded as source assertions.
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

describe('Saved keeps real Favorites as the only data source (no teammate mock architecture)', () => {
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
    expect(code).not.toMatch(/wecooked:userCollections/);
  });

  it('fetches favorites from the real FavoritesContext only', () => {
    expect(raw).toMatch(/import \{ useFavorites \} from '\.\.\/context\/FavoritesContext'/);
    expect(code).toMatch(/useFavorites\(\)/);
    expect(code).toMatch(/\breload\(\)/);
  });

  it('never fabricates smart collections or a recipe list of its own', () => {
    expect(code).not.toMatch(/Quick Meals|Healthy Meals|Weekend Cooking|Dinner Ideas|\bBreakfast\b/);
    expect(code).not.toMatch(/const\s+(recipes|RECIPES|COLLECTIONS)\s*=\s*\[/);
  });

  it('renders the Favorites card cover from the backend imageUrl only', () => {
    expect(raw).toMatch(/import RecipeImage from '\.\.\/components\/RecipeImage'/);
    expect(code).toMatch(/source=\{(cover\[0\]|entry)\.recipe\.imageUrl\}/);
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

  it('holds no authentication, session, or token state of its own', () => {
    expect(code).not.toMatch(/SecureStore|expo-secure-store|tokenStore/);
    expect(code).not.toMatch(/accessToken|refreshToken|idToken/);
    expect(code).not.toMatch(/useAuth\(/);
  });
});

describe('collection creation is honest about being unavailable, not fake', () => {
  it('the add-collection control shows a pending/unavailable message, not local persistence', () => {
    expect(code).toMatch(/collectionsUnavailable/);
    expect(code).toMatch(/Alert\.alert\(/);
  });
});
