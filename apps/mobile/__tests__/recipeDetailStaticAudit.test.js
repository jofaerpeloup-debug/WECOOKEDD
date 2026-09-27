// RecipeDetail final-frontend port — static source validation.
//
// This slice ports the teammate RecipeDetail *visual shell* (hero, rating/
// review summary, rate-this-recipe, metadata, ingredients, instructions, nutrition,
// actions, CTA) onto our real Recipe API + Favorites + Shopping List +
// CookMode + IngredientStudio wiring, with ONE approved product extension
// (the M3 category/region + dietary badge row). The mobile workspace has no
// RN renderer (see jest.config.js / [[wecooked-frontend-reconciliation]]),
// so the invariants below are encoded as source assertions against
// `apps/mobile/src/screens/RecipeDetailScreen.js`.
//
// "Forbidden" checks run against a comment-stripped copy so a phrase that
// only appears in an explanatory comment does not trip them; "must contain"
// checks run against the raw source. Checks scoped to the real API path
// (`ApiRecipeDetailContainer` / `ApiRecipeDetail`) are sliced out of the
// full file so an unrelated helper cannot satisfy a component assertion.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const raw = read('screens/RecipeDetailScreen.js');
const code = stripComments(raw);

// The real-API render path only: from the container through the end of
// ApiRecipeDetail, stopping before RecipeDetailNotice.
const apiStart = code.indexOf('function ApiRecipeDetailContainer');
const apiEnd = code.indexOf('function RecipeDetailNotice');
if (apiStart === -1 || apiEnd === -1 || apiEnd <= apiStart) {
  throw new Error('recipeDetailStaticAudit: could not locate the ApiRecipeDetail* source slice');
}
const apiCode = code.slice(apiStart, apiEnd);

describe('RecipeDetail (API mode) keeps our real recipe data architecture', () => {
  it('fetches the real recipe from the REST service, never a mock', () => {
    expect(raw).toMatch(/import \{ getRecipe \} from '\.\.\/api\/recipeService'/);
    expect(apiCode).toMatch(/await getRecipe\(recipeId\)/);
    expect(apiCode).not.toMatch(/data\/mockData/);
    expect(apiCode).not.toMatch(/\bmockData\b/);
    expect(apiCode).not.toMatch(/\bingredientSwaps\b/);
    expect(code).not.toMatch(/data\/mockData|LegacyRecipeDetail|useSavedRecipes|SavedRecipesContext/);
  });

  it('treats recipeId as authoritative and remounts on change', () => {
    expect(code).toMatch(/params\.recipeSource === 'api'/);
    expect(code).toMatch(/key=\{params\.recipeId\}/);
    expect(code).toMatch(/recipeId=\{params\.recipeId\}/);
    expect(apiCode).toMatch(/useEffect\(\(\) => \{/);
    expect(apiCode).toMatch(/gen !== genRef\.current/);
  });

  it('preserves loading / error / retry / not-found handling', () => {
    expect(apiCode).toMatch(/ActivityIndicator/);
    expect(apiCode).toMatch(/setNotFound\(true\)/);
    expect(apiCode).toMatch(/classifyRecipeDetailFailure\(err,/);
    expect(apiCode).toMatch(/failure === 'unavailable'/);
    expect(apiCode).toMatch(/onRetry=\{retry\}/);
    expect(apiCode).toMatch(/let cancelled = false;/);
    expect(apiCode).toMatch(/if \(cancelled \|\| gen !== genRef\.current\) return;/);
  });

  it('never renders a Favorites summary as full detail before hydration', () => {
    expect(apiCode).toMatch(/hasRecipeDetailData\(initialRecipe\) \? initialRecipe : null/);
  });

  it('renders recipe photography from the real backend imageUrl only', () => {
    expect(apiCode).toMatch(/<RecipeImage source=\{recipe\.imageUrl\}/);
    expect(apiCode).not.toMatch(/https?:\/\//);
    expect(apiCode).not.toMatch(/unsplash|picsum|pravatar/i);
  });

  it('never reintroduces cuisine or vibe anywhere in the screen', () => {
    expect(code).not.toMatch(/cuisine/i);
    expect(code).not.toMatch(/\bvibe\b/i);
  });
});

describe('RecipeDetail (API mode) final visible structure matches teammate order', () => {
  it('renders the sections in teammate order, with the approved badge extension after meta', () => {
    const order = [
      'ddHero',
      'ddTitle',
      'ddRatingRow',
      'ddRateRow',
      'ddMetaRow',
      'tagRow', // approved WeCooked extension: category/region + dietary badges
      'ddDescription',
      'ddSectionHeader', // Ingredients eyebrow + stepper
      'ddIngredientRow',
      'ddInstructionsSection',
      'ddNutritionCard',
      'ddActionRow', // meal plan
      'ddCtaWrap',
    ];
    const positions = order.map((key) => apiCode.indexOf(`styles.${key}`));
    for (const [i, pos] of positions.entries()) {
      expect(pos).toBeGreaterThan(-1);
      if (i > 0) expect(pos).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('hero controls are back, favorite, Collections, cart, share — in that order', () => {
    const heroStart = apiCode.indexOf('ddHero');
    const heroEnd = apiCode.indexOf('ddBody');
    const hero = apiCode.slice(heroStart, heroEnd);
    const order = ['chevron-back', 'FavoriteHeart', 'albums-outline', 'cart-outline', 'share-social-outline'];
    const positions = order.map((token) => hero.indexOf(token));
    for (const [i, pos] of positions.entries()) {
      expect(pos).toBeGreaterThan(-1);
      if (i > 0) expect(pos).toBeGreaterThan(positions[i - 1]);
    }
  });
});

describe('RecipeDetail (API mode) never fabricates backend-pending data', () => {
  it('rating/review summary is real (M5B): fetched from the Reviews API, never the old fake/local aggregate', () => {
    // The teammate local-blend aggregate (`shown.rating`/`shown.reviews`/
    // `useReviews`) must never come back — M5B replaces it with a real
    // fetch, not a revival of the mock-blended local rating.
    expect(apiCode).not.toMatch(/shown\.rating|shown\.reviews|useReviews/);
    expect(apiCode).not.toMatch(/AsyncStorage/);
    expect(raw).toMatch(
      /import \{ getRecipeReviews, createReview, updateReview \} from '\.\.\/api\/reviewService'/
    );
    expect(apiCode).toMatch(/await getRecipeReviews\(recipe\.id, \{ limit: 1 \}\)/);
    // Real, confirmed states only — "No ratings yet" is a real zero the
    // backend attested to, never a fabricated non-zero summary.
    expect(apiCode).toMatch(/No ratings yet/);
    expect(apiCode).not.toMatch(/\b5\.0\b/);
  });

  it('the teammate "Cooked" pill (c1c86ed) is real, M5C server-backed, boolean existence only', () => {
    // Real data path: a focused GET status call, never the teammate's mock
    // CookedRecipesContext, never a fabricated per-user fact.
    expect(raw).toMatch(/import \{ getRecipeStatus \} from '\.\.\/api\/cookHistoryService'/);
    expect(apiCode).not.toMatch(/useCookedRecipes|CookedRecipesContext|markCooked/);
    expect(apiCode).toMatch(/await getRecipeStatus\(recipe\.id\)/);

    // Rendered only when the server confirms it — exactly the teammate's
    // `{cooked && <View>...}` guard, never an unconditional/"unavailable"
    // placeholder pill.
    expect(apiCode).toMatch(/const cooked = cookedState\.hasCooked/);
    expect(apiCode).toMatch(/\{cooked && \(/);
    expect(apiCode).toMatch(/>Cooked</);
    expect(apiCode).not.toMatch(/Cook history/);
    expect(apiCode).not.toMatch(/Not cooked yet/);
  });

  it('the Cooked pill refetches status on every screen focus, so returning from CookMode refreshes it', () => {
    expect(raw).toMatch(/import \{ useFocusEffect \} from '@react-navigation\/native'/);
    expect(apiCode).toMatch(/useFocusEffect\(\s*useCallback\(\(\) => \{\s*loadCookedStatus\(\);/);
  });

  it('a failed refresh means UNKNOWN, not false — a previously confirmed hasCooked:true survives a later failed refresh', () => {
    const loadFnMatch = apiCode.match(/const loadCookedStatus = useCallback\(async \(\) => \{([\s\S]*?)\}, \[recipe\.id\]\)/);
    expect(loadFnMatch).toBeTruthy();
    const body = loadFnMatch[1];
    expect(body).toMatch(/catch \{/);
    // The catch block must carry the PREVIOUS hasCooked forward via a
    // functional update — never hardcode `hasCooked: false`, which would
    // erase a prior true.
    expect(body).toMatch(/setCookedState\(\(s\) => \(\{ status: 'error', hasCooked: s\.hasCooked \}\)\)/);
    expect(body).not.toMatch(/setCookedState\(\{ status: 'error', hasCooked: false \}\)/);
  });

  it('the pill derivation is not gated on status === \'ready\', so an error after a success still shows it', () => {
    // Cold load default is still `hasCooked: false` — an error with nothing
    // ever confirmed still renders no pill (see the initial useState below).
    expect(apiCode).toMatch(/useState\(\{ status: 'loading', hasCooked: false \}\)/);
    expect(apiCode).not.toMatch(/cookedState\.status === 'ready' && cookedState\.hasCooked/);
  });

  it('a legitimate successful hasCooked:false response still clears a stale pill (only failure is preserved, not every non-true response)', () => {
    // The success branch always installs the server's own value verbatim —
    // never merged with the previous state — so a real false overwrites a
    // stale true exactly as a real true overwrites a stale false.
    expect(apiCode).toMatch(/setCookedState\(\{ status: 'ready', hasCooked \}\)/);
  });

  it('cannot leak cooked state across a recipe or account change — cookedState is local, unpersisted component state', () => {
    // No AsyncStorage, no module-level cache, no global variable: the only
    // place `hasCooked` lives is this component instance's own useState, so
    // it cannot outlive that instance. A recipe change remounts this whole
    // component via `key={params.recipeId}` (asserted in "treats recipeId as
    // authoritative and remounts on change" above); an account change
    // remounts the entire authenticated stack via RootNavigator's
    // `{isLoggedIn ? (...) : (...)}` swap (see
    // navigationShellStaticAudit.test.js's "auth architecture untouched").
    // Neither boundary leaves this component instance — or its cookedState —
    // alive to leak into the next recipe or the next signed-in user.
    expect(apiCode).toMatch(/const \[cookedState, setCookedState\] = useState\(\{ status: 'loading', hasCooked: false \}\)/);
    expect(apiCode).not.toMatch(/AsyncStorage|loadJSON|saveJSON/);
    expect(code).not.toMatch(/globalThis\.|global\.__|moduleCookedCache|let\s+cachedCooked/);
  });

  it('does not cache cooked ids globally — no CookHistoryContext import, just a screen-local focused fetch', () => {
    // Checked against comment-stripped `code`: the surrounding source has an
    // explanatory comment that names CookHistoryContext by way of explaining
    // why it is deliberately NOT used here — that mention alone must not
    // trip this assertion.
    expect(code).not.toMatch(/CookHistoryContext/);
    expect(code).not.toMatch(/useCookHistory/);
  });

  it('the five-star row submits a real rating (M5B): POST first-time, PATCH thereafter, never a fake success', () => {
    expect(apiCode).toMatch(/Rate this recipe/);
    expect(apiCode).toMatch(/Your rating/);
    expect(apiCode).toMatch(/\[1, 2, 3, 4, 5\]\.map/);
    expect(apiCode).toMatch(/onPress=\{\(\) => submitRating\(n\)\}/);
    expect(apiCode).toMatch(/await createReview\(recipe\.id, \{ rating: n \}\)/);
    expect(apiCode).toMatch(/await updateReview\(previousReview\.id, \{ rating: n \}\)/);
    // Rollback on failure — an optimistic star fill is never left standing
    // as a fake success once the request actually failed.
    expect(apiCode).toMatch(/myReview: previousReview/);
    expect(apiCode).toMatch(/getReviewErrorMessage\(err\)/);
    expect(apiCode).not.toMatch(/setRating\(|AsyncStorage/);
  });

  it('never sends a client-computed rating aggregate — averageRating/ratingCount are read-only from the server', () => {
    expect(apiCode).not.toMatch(/averageRating\s*:\s*(?!refreshed|reviewState|summary)/);
    expect(apiCode).not.toMatch(/ratingCount\s*:\s*(?!refreshed|reviewState|summary)/);
  });

  it('Collections is real (M5A): opens the real CollectionPickerSheet, no local/mock state', () => {
    expect(apiCode).toMatch(/name="albums-outline"/);
    expect(apiCode).toMatch(/openCollections = \(\) => setCollectionsOpen\(true\)/);
    expect(raw).toMatch(/import CollectionPickerSheet from '\.\.\/components\/CollectionPickerSheet'/);
    expect(apiCode).toMatch(/<CollectionPickerSheet/);
    expect(apiCode).toMatch(/recipeId=\{recipe\.id\}/);
    expect(apiCode).not.toMatch(/AsyncStorage/);
    expect(apiCode).not.toMatch(/useSavedCollections|mockCollections/);
  });

  it('Collections is NOT repurposed to open Saved/CollectionDetail — it opens an in-place picker', () => {
    // Saved's teammate-authoritative entry point is the Dashboard header
    // bookmark (see dashboardStaticAudit.test.js), not this icon — the
    // teammate's own albums-outline control opens an in-place add-to-collection
    // sheet (CollectionPickerSheet), never a navigation to a Saved/collections
    // screen. Confirmed by reading `c1c86ed`.
    expect(apiCode).not.toMatch(/openCollections[\s\S]{0,80}navigate\(\s*['"`](Saved|CollectionDetail)/);
    expect(apiCode).not.toMatch(/onPress=\{openCollections\}[\s\S]{0,200}navigate\(\s*['"`](Saved|CollectionDetail)/);
    expect(apiCode).not.toMatch(/CollectionDetail/);
  });

  it('Nutrition Info card never fabricates macros', () => {
    expect(apiCode).toMatch(/Nutrition Info/);
    expect(apiCode).toMatch(/isn't available for this recipe yet/);
    expect(apiCode).not.toMatch(/calories|protein|carbs|\bfat\b|estimateNutrition|estimateMacros/i);
  });
});

describe('RecipeDetail (API mode) keeps real ingredients and instructions visible', () => {
  it('renders authoritative ordered instruction steps with an honest empty state', () => {
    expect(raw).toMatch(/import \{[\s\S]*?cookModeSteps[\s\S]*?\} from '\.\.\/utils\/recipe'/);
    expect(apiCode).toMatch(/const instructionSteps = useMemo\(\(\) => cookModeSteps\(recipe\), \[recipe\]\)/);
    expect(apiCode).toMatch(/<Text style=\{styles\.ddEyebrow\}>Instructions<\/Text>/);
    expect(apiCode).toMatch(/instructionSteps\.map\(\(step\) =>/);
    expect(apiCode).toMatch(/\{step\.order\}/);
    expect(apiCode).toMatch(/\{step\.text\}/);
    expect(apiCode).toMatch(/No instructions listed\./);
  });

  it('restores the real per-ingredient substitution sheet without a mock data path', () => {
    expect(raw).toMatch(/import SubstitutionsSheet from '\.\.\/components\/SubstitutionsSheet'/);
    expect(apiCode).toMatch(/substitutesCacheRef = useRef\(new Map\(\)\)/);
    expect(apiCode).toMatch(/openSubstitutes/);
    expect(apiCode).toMatch(/<SubstitutionsSheet/);
    expect(apiCode).toMatch(/<Text style=\{styles\.ddSubstituteText\}>Substitutes<\/Text>/);
    expect(apiCode).not.toMatch(/ingredientSwaps|molecularSwap/);
  });

  it('ingredient rows use separate left (identity) / right (scaled qty+unit) presentation', () => {
    expect(code).toMatch(/function ingredientDisplayRow\(entry, opts\)/);
    expect(apiCode).toMatch(/\.map\(\(entry\) => ingredientDisplayRow\(entry,/);
    expect(apiCode).toMatch(/row\.qtyText/);
    expect(apiCode).toMatch(/row\.name/);
    // still merged for CookMode, via the untouched shared formatter:
    expect(apiCode).toMatch(/ingredientDisplayText\(entry, \{ selectedServings: servings, baseServings \}\)/);
  });
});

describe('RecipeDetail (API mode) keeps the approved category/region badge extension', () => {
  it('still calls the real recipeBadges() with no fabricated classifier', () => {
    expect(apiCode).toMatch(/const badges = recipeBadges\(recipe\);/);
    expect(raw).toMatch(/import \{[\s\S]*?recipeBadges[\s\S]*?\} from '\.\.\/utils\/recipe'/);
  });

  it('recipeBadges prefers category, falls back to region, never fabricates a value', () => {
    const recipeUtilCode = stripComments(read('utils/recipe.js'));
    expect(recipeUtilCode).toMatch(/categoryLabel\(recipe && recipe\.category\) \|\| regionLabel\(recipe && recipe\.region\)/);
    // Retirement is documented in a comment (already covered by
    // recipeCuisineRetired.test.js) — the code itself never reads it.
    expect(recipeUtilCode).not.toMatch(/recipe\.cuisine/);
  });
});

describe('RecipeDetail (API mode) keeps real Favorites / Shopping List / CookMode / swap routing', () => {
  it('uses the real shared FavoritesProvider heart, not a second local favorites state', () => {
    expect(raw).toMatch(/import FavoriteHeart from '\.\.\/components\/FavoriteHeart'/);
    expect(apiCode).toMatch(/<FavoriteHeart recipe=\{recipe\}/);
    expect(apiCode).not.toMatch(/useSavedRecipes|SavedRecipesContext/);
  });

  it('adds to the real Shopping List via the recipe id only, no local dual-write, no bottom button', () => {
    expect(apiCode).toMatch(/const \{ addRecipe, isMutating, pendingAction \} = useShoppingList\(\);/);
    expect(apiCode).toMatch(/await addRecipe\(recipe\.id\)/);
    expect(apiCode).not.toMatch(/addFromRecipe/);
    expect(apiCode).not.toMatch(/Add All to Shopping List/);
  });

  it('preserves the CookMode route contract exactly, with the full recipe object (steps/instructions intact)', () => {
    expect(apiCode).toMatch(
      /navigation\.navigate\('CookMode', \{\s*recipeSource: 'api',\s*recipe,\s*ingredients: ingredientLines,\s*servings,\s*\}\);/
    );
  });

  it('CookMode still reads real instruction data off the recipe it receives', () => {
    const cookModeSrc = read('screens/CookModeScreen.js');
    expect(cookModeSrc).toMatch(/cookModeSteps\(recipe\)/);
  });

  it('MealPlan opens the real current-week day picker while general swaps use the live per-ingredient control', () => {
    expect(apiCode).toMatch(/setMealPlanOpen\(true\)/);
    expect(apiCode).toMatch(/<MealPlanSheet[\s\S]*?recipeId=\{recipe\.id\}/);
    expect(apiCode).toMatch(/Tap Substitutes beside an ingredient above/);
    expect(apiCode).not.toMatch(/navigation\.navigate\('IngredientStudio'/);
  });
});

describe('RecipeDetail (API mode) does not cross security / navigation boundaries', () => {
  it('holds no authentication, session, or local-storage state of its own', () => {
    expect(apiCode).not.toMatch(/SecureStore|expo-secure-store|tokenStore/);
    expect(apiCode).not.toMatch(/accessToken|refreshToken|idToken/);
    expect(apiCode).not.toMatch(/AsyncStorage/);
    expect(apiCode).not.toMatch(/useAuth\(/);
  });

  it('never resets or replaces the navigation stack', () => {
    expect(apiCode).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(apiCode).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
  });

  it('carries no client/provider secrets or token material', () => {
    expect(apiCode).not.toMatch(/clientId|CLIENT_ID|apiKey|API_KEY|secret|Bearer /i);
  });
});

describe('RecipeDetail rejects legacy/mock route payloads', () => {
  it('renders an honest unavailable notice unless recipeSource and recipeId identify API data', () => {
    expect(code).toMatch(/params\.recipeSource === 'api' && params\.recipeId/);
    expect(code).toMatch(/return <InvalidRecipeDetail navigation=\{navigation\} \/>/);
    expect(code).toMatch(/message="This recipe isn't available\."/);
    expect(code).not.toMatch(/params\.recipe\b|function LegacyRecipeDetail\(/);
  });

  it("no current screen caller of RecipeDetail omits recipeSource: 'api'", () => {
    const callers = [
      'screens/DashboardScreen.js',
      'screens/DiscoverScreen.js',
      'screens/MealPlanScreen.js',
      // Saved itself no longer opens RecipeDetail directly — it only
      // navigates into CollectionDetail, which owns the real recipe rows.
      'screens/CollectionDetailScreen.js',
    ].map(read);
    for (const src of callers) {
      const calls = [...src.matchAll(/navigation\.navigate\(\s*'RecipeDetail',\s*\{([\s\S]{0,200}?)\}\s*\)/g)];
      expect(calls.length).toBeGreaterThan(0);
      for (const [, args] of calls) {
        expect(args).toMatch(/recipeSource:\s*'api'/);
      }
    }
  });
});
