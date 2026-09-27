const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, '../src/screens/RecipeReviewsScreen.js'), 'utf8');
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

function functionBody(name, nextName) {
  const start = code.indexOf(name);
  const end = nextName ? code.indexOf(nextName, start + name.length) : code.length;
  if (start < 0 || end < 0) throw new Error(`Could not locate ${name}`);
  return code.slice(start, end);
}

const firstPage = functionBody('const loadFirstPage', 'const loadMore');
const cookStatus = functionBody('const loadCookStatus', 'useFocusEffect');
const loadMore = functionBody('const loadMore', 'const runMutation');
const mutation = functionBody('const runMutation', 'const submitReview');
const submit = functionBody('const submitReview', 'const confirmDelete');
const deletion = functionBody('const confirmDelete', 'const renderReview');
const row = functionBody('const renderReview', 'const renderHeader');

describe('RecipeReviews authoritative reads and rendering', () => {
  it('reads exact route identity and requests newest-first page 1', () => {
    expect(code).toMatch(/const recipeId = route\.params\?\.recipeId/);
    expect(code).toMatch(/const recipeTitle = route\.params\?\.recipeTitle/);
    expect(firstPage).toMatch(/getRecipeReviews\(recipeId, \{\s*page: 1,\s*limit: PAGE_LIMIT,\s*sort: 'newest'/);
  });

  it('commits the server list, summary, pagination, and currentUserReview together', () => {
    for (const binding of ['setReviews(result.reviews)', 'setSummary(result.summary)', 'paginationRef.current = result.pagination', 'setCurrentUserReview(result.currentUserReview)']) {
      expect(firstPage).toContain(binding);
    }
    expect(firstPage).toMatch(/setDraftRating\(result\.currentUserReview\?\.rating \|\| 0\)/);
    expect(firstPage).toMatch(/setDraftComment\(result\.currentUserReview\?\.comment \|\| ''\)/);
  });

  it('renders only returned author/rating/comment/timestamps with a neutral null-author fallback', () => {
    expect(row).toMatch(/item\.author\?\.name \|\| 'Unknown user'/);
    expect(row).toMatch(/star <= item\.rating/);
    expect(row).toMatch(/\{item\.comment \? <Text[^>]*>\{item\.comment\}<\/Text> : null\}/);
    expect(row).toMatch(/reviewDate\(item\)/);
    expect(code).not.toMatch(/mockData|AsyncStorage|Date\.now\(|Math\.random\(|seededReviews|fakeUser/i);
  });
});

describe('RecipeReviews pagination and state safety', () => {
  it('uses page/totalPages authority and synchronously guards duplicate load-more', () => {
    expect(loadMore).toMatch(/loadingMoreRef\.current/);
    expect(loadMore).toMatch(/currentPagination\.page >= currentPagination\.totalPages/);
    expect(loadMore).toMatch(/const nextPage = currentPagination\.page \+ 1/);
    expect(loadMore).toMatch(/paginationRef\.current/);
    expect(loadMore).not.toMatch(/reviews\.length\s*===\s*PAGE_LIMIT/);
  });

  it('invalidates stale page requests on refresh, recipe change, and unmount', () => {
    expect(firstPage).toMatch(/const generation = \+\+generationRef\.current/);
    expect(firstPage).toMatch(/generation !== generationRef\.current/);
    expect(loadMore).toMatch(/const generation = generationRef\.current/);
    expect(loadMore).toMatch(/generation !== generationRef\.current/);
    expect(code).toMatch(/generationRef\.current \+= 1/);
    expect(code).toMatch(/\}, \[recipeId\]\)/);
  });

  it('keeps loading, error, confirmed-empty, refreshing, and load-more states distinct', () => {
    expect(code).toMatch(/phase === 'loading'/);
    expect(code).toMatch(/phase === 'error'/);
    expect(code).toMatch(/No reviews yet/);
    expect(code).toMatch(/refreshing=\{refreshing\}/);
    expect(code).toMatch(/loadingMore/);
    expect(code).toMatch(/loadMoreError/);
    expect(firstPage).toMatch(/setPhase\(refresh && reviewsRef\.current\.length > 0 \? 'ready' : 'error'\)/);
  });
});

describe('RecipeReviews authoritative mutations', () => {
  it('POSTs only for known no-review state and PATCHes the authoritative existing review', () => {
    expect(submit).toMatch(/phase !== 'ready'/);
    expect(submit).toMatch(/if \(currentUserReview\)[\s\S]*updateReview\(currentUserReview\.id/);
    expect(submit).toMatch(/createRecipeReview\(recipeId/);
    const mutant = submit.replace('if (currentUserReview)', 'if (!currentUserReview)');
    expect(mutant).not.toMatch(/if \(currentUserReview\)[\s\S]*updateReview\(currentUserReview\.id/);
  });

  it('gates only first creation on authoritative known-true cook status', () => {
    expect(code).toMatch(/const canCreateFirstReview = phase === 'ready'[\s\S]*!currentUserReview[\s\S]*cookState\.status === 'ready'[\s\S]*cookState\.hasCooked/);
    expect(submit).toMatch(/if \(currentUserReview\)[\s\S]*updateReview\(currentUserReview\.id/);
    expect(submit).toMatch(/if \(!canCreateFirstReview\) return;[\s\S]*createRecipeReview/);
    expect(code).toMatch(/editorDisabled = mutationBusy \|\| \(!currentUserReview && !canCreateFirstReview\)/);
  });

  it('keeps existing-review edit and delete available when cook status is false or unknown', () => {
    expect(code).toMatch(/editorDisabled = mutationBusy \|\| \(!currentUserReview && !canCreateFirstReview\)/);
    expect(deletion).not.toMatch(/cookState|hasCooked|canCreateFirstReview/);
    const updateBranch = submit.slice(submit.indexOf('if (currentUserReview)'), submit.indexOf('return;', submit.indexOf('if (currentUserReview)')));
    expect(updateBranch).not.toMatch(/cookState|hasCooked|canCreateFirstReview/);
  });

  it('deletes only currentUserReview.id after explicit rating-and-comment confirmation', () => {
    expect(deletion).toMatch(/if \(!currentUserReview \|\| mutationBusyRef\.current\) return/);
    expect(deletion).toMatch(/const reviewId = currentUserReview\.id/);
    expect(deletion).toMatch(/both your written comment and your star rating/);
    expect(deletion).toMatch(/runMutation\(\(\) => deleteReview\(reviewId\)\)/);
  });

  it('serializes mutations and reloads authoritative page 1 after success', () => {
    expect(mutation).toMatch(/mutationBusyRef\.current/);
    expect(mutation).toMatch(/await operation\(\)/);
    expect(mutation).toMatch(/await loadFirstPage\(\)/);
    expect(code).toMatch(/accessibilityState=\{\{ disabled:[^}]*busy: mutationBusy/);
  });

  it('treats REVIEW_ALREADY_EXISTS as stale state: refetches and never retries POST', () => {
    expect(mutation).toMatch(/mutationError\?\.code === 'REVIEW_ALREADY_EXISTS'/);
    expect(mutation).toMatch(/await loadFirstPage\(\)/);
    const conflict = mutation.slice(mutation.indexOf("REVIEW_ALREADY_EXISTS"));
    expect(conflict).not.toMatch(/createRecipeReview/);
  });

  it('refreshes review and cook authority after REVIEW_COOK_REQUIRED without retrying POST', () => {
    expect(mutation).toMatch(/mutationError\?\.code === 'REVIEW_COOK_REQUIRED'/);
    expect(mutation).toMatch(/Promise\.all\(\[loadFirstPage\(\), loadCookStatus\(\)\]\)/);
    const conflict = mutation.slice(mutation.indexOf("REVIEW_COOK_REQUIRED"));
    expect(conflict).not.toMatch(/createRecipeReview/);
  });
});

describe('RecipeReviews cook eligibility lifecycle', () => {
  it('loads status from the existing service and refreshes it on focus with stale-response guards', () => {
    expect(raw).toMatch(/import \{ getRecipeStatus \} from '\.\.\/api\/cookHistoryService'/);
    expect(cookStatus).toMatch(/await getRecipeStatus\(recipeId\)/);
    expect(cookStatus).toMatch(/generation !== cookGenerationRef\.current/);
    expect(code).toMatch(/useFocusEffect\(\s*useCallback\(\(\) => \{\s*loadCookStatus\(\)/);
  });

  it('keeps reviews readable while explaining the disabled first-review controls', () => {
    expect(code).toMatch(/Complete this recipe in WeCooked before rating or reviewing it\./);
    expect(code).toMatch(/Return to recipe to start cooking/);
    expect(code).toMatch(/navigation\.goBack\(\)/);
    expect(code).not.toMatch(/Verified cook|Verified reviewer|Proof of cooking|Confirmed real cook/i);
  });

  it('does not misstate unknown/error cook status as confirmed ineligibility', () => {
    expect(code).toMatch(/cookState\.status === 'ready'[\s\S]*Complete this recipe in WeCooked/);
    expect(code).toMatch(/Checking your WeCooked cooking status/);
    expect(code).toMatch(/couldn’t confirm your WeCooked cooking status/);
  });
});

describe('RecipeReviews accessibility and honest UI', () => {
  it('labels editor stars, comment, submit, destructive delete, retry, refresh, and rows', () => {
    for (const phrase of [
      'Review rating',
      'Written review comment, optional',
      'Submit your review',
      'Delete review, comment, and star rating',
      'Retry loading reviews',
      'Refresh reviews',
      'rating only',
    ]) expect(raw).toContain(phrase);
  });

  it('uses theme tokens and supports wrapping instead of fixed reviewer/comment dimensions', () => {
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).toMatch(/numberOfLines=\{2\}/);
    expect(code).toMatch(/lineHeight: 21/);
    expect(code).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
