const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE_ROOT = path.join(__dirname, '../src');
const REPO_ROOT = path.join(__dirname, '../../..');
const COMM6_BASELINE = '715ad26317246389dd1084b98f134f6af65eb2ac';
const COMM6_PRODUCTION_FILE = 'apps/mobile/src/screens/CommunityScreen.js';
const COMM6_ALLOWLIST = new Set([
  COMM6_PRODUCTION_FILE,
  'apps/mobile/__tests__/communityInteraction.test.js',
  'apps/mobile/__tests__/communityStaticAudit.test.js',
  'apps/mobile/__tests__/recipeDetailStaticAudit.test.js',
  'docs/milestones/MOBILE-COMM6-recipe-cta-final-community-cards.md',
]);
const COMM5_ALLOWLIST = new Set([
  'apps/api/src/modules/community/community-post-bookmark.model.js',
  'apps/api/src/modules/community/community-bookmark.repository.js',
  'apps/api/src/modules/community/community.repository.js',
  'apps/api/src/modules/community/community.validation.js',
  'apps/api/src/modules/community/community.service.js',
  'apps/api/src/modules/community/community.serializer.js',
  'apps/api/src/modules/community/community.controller.js',
  'apps/api/src/modules/community/community.routes.js',
  'apps/mobile/src/api/communityService.js',
  'apps/mobile/src/screens/CommunityScreen.js',
  'apps/api/test/community-model.test.js',
  'apps/api/test/community-repository.test.js',
  'apps/api/test/community-routes.test.js',
  'apps/api/test/community-bookmark-mongo.test.js',
  'apps/mobile/__tests__/communityService.test.js',
  'apps/mobile/__tests__/communityStaticAudit.test.js',
  'apps/mobile/__tests__/communityInteraction.test.js',
]);

function read(relativePath) {
  return fs.readFileSync(path.join(SOURCE_ROOT, relativePath), 'utf8');
}

function pathsFromNameStatus(output) {
  return output.trim().split(/\r?\n/).filter(Boolean)
    .flatMap((line) => line.split('\t').slice(1))
    .map((file) => file.replace(/\\/g, '/'));
}

function assertComm6Scope(paths) {
  const normalized = [...new Set(paths.map((file) => file.replace(/\\/g, '/')))];
  const outsideAllowlist = normalized.filter((file) => !COMM6_ALLOWLIST.has(file));
  if (outsideAllowlist.length > 0) {
    throw new Error(`COMM6 diff scope drift: ${outsideAllowlist.join(', ')}`);
  }
  if (!normalized.includes(COMM6_PRODUCTION_FILE)) {
    throw new Error(`COMM6 production diff missing: ${COMM6_PRODUCTION_FILE}`);
  }
}

function addedLinesFromPatch(patch) {
  return patch.split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

function importedApiBindings(source) {
  return [...source.matchAll(/import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];?/g)]
    .filter((match) => /(?:api|service|client)/i.test(match[2]))
    .flatMap((match) => match[1].match(/[A-Za-z_$][\w$]*/g) || [])
    .filter((name) => name !== 'as');
}

function assertComm6PatchBoundaries(additions, apiBindings) {
  const navigationCalls = [...additions.matchAll(/\bnavigation\s*(?:\.\s*|\[\s*['"])(navigate|push|replace|reset|dispatch|goBack)\b/g)];
  const exactRecipeDetailCall = /navigation\.navigate\(\s*['"]RecipeDetail['"]\s*,\s*\{\s*recipeSource:\s*['"]api['"]\s*,\s*recipeId:\s*attachment\.recipe\.id\s*,?\s*\}\s*\)/g;
  if (navigationCalls.length !== 1 || navigationCalls[0][1] !== 'navigate'
      || [...additions.matchAll(exactRecipeDetailCall)].length !== 1) {
    throw new Error('COMM6 navigation drift');
  }
  const importsScreen = [...additions.matchAll(/import\s+([^;]+?)\s+from\s+['"][^'"]+['"];?/g)]
    .some((match) => /\b\w*Screen\b/.test(match[1]));
  if (importsScreen || /(?:Stack|Tab|Drawer)\.Screen|create\w*Navigator|component\s*:\s*\w*Screen\b|\b(?:function|class)\s+(?!CommunityScreen\b)\w*Screen\b|\bconst\s+(?!CommunityScreen\b)\w*Screen\s*=/.test(additions)) {
    throw new Error('COMM6 route or screen registration drift');
  }

  const escapedBindings = apiBindings.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const callsExistingApi = escapedBindings.length > 0
    && new RegExp(`\\b(?:${escapedBindings.join('|')})\\s*\\(`).test(additions);
  const addsApiImport = /(?:import|require)[^\n]*['"][^'"]*(?:api|service|client)[^'"]*['"]/i.test(additions);
  const addsNetworkPrimitive = /\b(?:fetch|axios|XMLHttpRequest|WebSocket|EventSource)\b|\b\w*(?:api|http|service|client)\w*\s*\.\s*(?:get|post|put|patch|delete|request)\s*\(/i.test(additions);
  const addsEndpointLiteral = /['"`]\s*(?:https?:\/\/|\/(?![/*]))/.test(additions);
  if (callsExistingApi || addsApiImport || addsNetworkPrimitive || addsEndpointLiteral) {
    throw new Error('COMM6 API or endpoint drift');
  }

  if (/\b(?:mock|fixture|sample|dummy|seed)(?:Recipe|Data)?\b|\b(?:AsyncStorage|SecureStore|localStorage|sessionStorage|persist\w*|cache\w*)\b/i.test(additions)
      || /\b(?:initialRecipe|fullRecipe)\s*:|\brecipe\s*:\s*(?:\{|attachment\b)|\.\.\.\s*attachment(?:\.recipe)?\b/i.test(additions)
      || /attachment(?:\.recipe)?[^\n]*ingredients|ingredients[^\n]*attachment(?:\.recipe)?/i.test(additions)) {
    throw new Error('COMM6 local recipe authority or reconstruction drift');
  }

  if (/\b(?:Trending|For You|PublicProfile|UserProfile)\b|navigate\s*\([^)]*Profile/i.test(additions)) {
    throw new Error('COMM6 deferred feature drift');
  }
}

const SCREEN = read('screens/CommunityScreen.js');
const SERVICE = read('api/communityService.js');
const COMM6_CHANGED_PATHS = pathsFromNameStatus(execFileSync(
  'git', ['diff', '--name-status', '--find-renames', COMM6_BASELINE, '--'],
  { cwd: REPO_ROOT, encoding: 'utf8' }
));
const COMM6_ADDITIONS = addedLinesFromPatch(execFileSync(
  'git', ['diff', '--no-ext-diff', '--unified=0', COMM6_BASELINE, '--', COMM6_PRODUCTION_FILE],
  { cwd: REPO_ROOT, encoding: 'utf8' }
));
const UNTRACKED_PATHS = execFileSync(
  'git', ['ls-files', '--others', '--exclude-standard'],
  { cwd: REPO_ROOT, encoding: 'utf8' }
).trim().split(/\r?\n/).filter(Boolean).map((file) => file.replace(/\\/g, '/'));
const COMM5_CHANGED_PATHS = [...new Set([...COMM6_CHANGED_PATHS, ...UNTRACKED_PATHS])]
  .filter((file) => file.startsWith('apps/api/src/')
    || file.startsWith('apps/mobile/src/')
    || /^apps\/api\/test\/community.*\.test\.js$/.test(file)
    || /^apps\/mobile\/__tests__\/community.*\.test\.js$/.test(file));
const API_BINDINGS = importedApiBindings(SCREEN);

describe('Community M10A real integration', () => {
  it('keeps the teammate shell and unchanged tab navigation contract', () => {
    expect(SCREEN).toMatch(/<TopBar mode="title" title="Community"/);
    expect(SCREEN).toMatch(/See what other home cooks are making/);
    expect(SCREEN).toMatch(/styles\.composeCard/);
    expect(SCREEN).toMatch(/placeholder="Share what you're cooking\.\.\."/);
    expect(SCREEN).toMatch(/Tag a recipe \(optional\)/);
  });

  it('uses real Community and Recipe APIs with no legacy local/mock persistence', () => {
    expect(SCREEN).toMatch(/from '\.\.\/api\/communityService'/);
    expect(SCREEN).toMatch(/from '\.\.\/api\/recipeService'/);
    expect(SCREEN).toMatch(/listCommunityPosts/);
    expect(SCREEN).toMatch(/listRecipes/);
    expect(SCREEN).not.toMatch(/mockData|communityPosts|CommunityContext|AsyncStorage|loadJSON|saveJSON/);
    expect(SERVICE).not.toMatch(/AsyncStorage|mockData|fetch\(/);
  });

  it('has honest initial loading, error/retry, empty, refresh, and pagination UI', () => {
    expect(SCREEN).toMatch(/Loading Community/);
    expect(SCREEN).toMatch(/Couldn’t load Community/);
    expect(SCREEN).toMatch(/setFeedReloadKey/);
    expect(SCREEN).toMatch(/No posts yet/);
    expect(SCREEN).toMatch(/RefreshControl/);
    expect(SCREEN).toMatch(/Load more posts/);
    expect(SCREEN).toMatch(/pagination\.page < pagination\.totalPages/);
    expect(SCREEN).toMatch(/const seen = new Set\(existing\.map\(\(item\) => item\.id\)\)/);
    expect(SCREEN).toMatch(/incoming\.filter\(\(item\) => !seen\.has\(item\.id\)\)/);
  });

  it('enforces required bounded text and one optional real recipe selection', () => {
    expect(SCREEN).toMatch(/MAX_CAPTION_LENGTH = 2000/);
    expect(SCREEN).toMatch(/maxLength=\{MAX_CAPTION_LENGTH\}/);
    expect(SCREEN).toMatch(/const trimmed = caption\.trim\(\)/);
    expect(SCREEN).toMatch(/if \(!trimmed \|\| postCreateOperationRef\.current \|\| !ownerId\) return/);
    expect(SCREEN).toMatch(/current\?\.id === recipe\.id \? null : recipe/);
    expect(SCREEN).toMatch(/recipeId: selectedRecipe\?\.id/);
    expect(SCREEN).not.toMatch(/cuisine|vibe/);
  });

  it('clears the composer only after authoritative create succeeds and preserves it on failure', () => {
    const awaitCreate = SCREEN.indexOf('await createCommunityPost');
    const clearCaption = SCREEN.indexOf("setCaption('')", awaitCreate);
    const catchBlock = SCREEN.indexOf('catch (error)', awaitCreate);
    expect(awaitCreate).toBeGreaterThan(-1);
    expect(clearCaption).toBeGreaterThan(awaitCreate);
    expect(clearCaption).toBeLessThan(catchBlock);
    expect(SCREEN.slice(catchBlock, SCREEN.indexOf('finally', catchBlock))).not.toMatch(/setCaption|setSelectedRecipe/);
  });

  it('renders safe author initials, server createdAt, real recipe state, and real comments', () => {
    expect(SCREEN).toMatch(/post\.author\?\.name/);
    expect(SCREEN).toMatch(/AuthorAvatar author=\{post\.author\}/);
    expect(SCREEN).toMatch(/AuthorAvatar author=\{comment\.author\}/);
    expect(SCREEN).toMatch(/author\?\.avatarUrl/);
    expect(SCREEN).toMatch(/formatCommunityTime\(post\.createdAt\)/);
    expect(SCREEN).toMatch(/attachment\?\.isAvailable/);
    expect(SCREEN).toMatch(/Recipe unavailable/);
    expect(SCREEN).toMatch(/post\.commentCount/);
    expect(SCREEN).toMatch(/accessibilityLabel=\{`\$\{post\.commentCount\} comments`\}/);
    expect(SCREEN).toMatch(/listCommunityComments/);
    expect(SCREEN).toMatch(/createCommunityComment/);
    expect(SCREEN).toMatch(/deleteCommunityComment/);
    expect(SERVICE).toMatch(/\/community\/posts\/\$\{encodeURIComponent\(postId\)\}\/comments/);
    expect(SCREEN).not.toMatch(/avatar\.uri|author\.email|author\.role/);
  });

  it('renders the final Community card in the frozen visible order', () => {
    const card = SCREEN.slice(
      SCREEN.indexOf('<View key={post.id} style={styles.card}>'),
      SCREEN.indexOf("{feedStatus === 'ready' && pagination")
    );
    const positions = [
      card.indexOf('styles.postHeader'),
      card.indexOf('AuthorAvatar author={post.author}'),
      card.indexOf('formatCommunityTime(post.createdAt)'),
      card.indexOf('styles.followButton'),
      card.indexOf('{post.isOwner && ('),
      card.indexOf('attachment?.isAvailable && attachment.recipe && <RecipeImage'),
      card.indexOf('styles.unavailableRecipe'),
      card.indexOf('styles.tagRow'),
      card.indexOf('<Text style={styles.caption}>{post.caption}</Text>'),
      card.indexOf('accessibilityLabel="View Recipe"'),
      card.indexOf('styles.actionRow'),
      card.indexOf('activePostId === post.id'),
    ];

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('guards View Recipe with exact availability and a valid non-empty recipe id', () => {
    expect(SCREEN).toMatch(/const canViewRecipe = attachment\?\.isAvailable === true\s*&& typeof attachment\.recipe\?\.id === 'string'\s*&& attachment\.recipe\.id\.trim\(\)\.length > 0/);
    expect(SCREEN).toMatch(/\{canViewRecipe && \([\s\S]*accessibilityRole="button"[\s\S]*accessibilityLabel="View Recipe"/);
    expect(SCREEN).toMatch(/navigation\.navigate\('RecipeDetail', \{\s*recipeSource: 'api',\s*recipeId: attachment\.recipe\.id,\s*\}\)/);
  });

  it('confines the baseline diff to the exact COMM6 production and evidence files', () => {
    expect(COMM6_CHANGED_PATHS).toContain(COMM6_PRODUCTION_FILE);

    for (const mutant of [
      'apps/mobile/src/screens/AnotherScreen.js',
      'apps/mobile/src/navigation/Routes.js',
      'apps/mobile/src/api/transport.js',
      'apps/mobile/src/utils/recipeBridge.js',
      'apps/mobile/package.json',
      'config/mobile-runtime.js',
    ]) {
      expect(() => assertComm6Scope([COMM6_PRODUCTION_FILE, mutant]))
        .toThrow(`COMM6 diff scope drift: ${mutant}`);
    }
  });

  it('allows only the frozen RecipeDetail CTA in the COMM6 production additions', () => {
    const frozenCta = "navigation.navigate('RecipeDetail', { recipeSource: 'api', recipeId: attachment.recipe.id })";
    expect(() => assertComm6PatchBoundaries(frozenCta, [])).not.toThrow();
  });

  it('rejects navigation, endpoint, local-authority, reconstruction, and deferred-feature mutants', () => {
    const mutants = [
      "navigation.navigate('ChefDashboard')",
      "fetch('/totally-new-endpoint')",
      'listRecipes({ page: 1 })',
      'const recipe = { ...attachment.recipe }',
      'const ingredients = attachment.recipe.ingredients',
      "AsyncStorage.setItem('cta', attachment.recipe.id)",
      "const feedMode = 'Trending'",
      "navigation.navigate('PublicProfile')",
    ];

    for (const mutant of mutants) {
      expect(() => assertComm6PatchBoundaries(`${COMM6_ADDITIONS}\n${mutant}`, API_BINDINGS)).toThrow();
    }
  });

  it('keeps comments lazy, server-counted, bounded, pessimistic, and generation guarded', () => {
    expect(SCREEN).toMatch(/activePostId === post\.id/);
    expect(SCREEN).toMatch(/MAX_COMMENT_LENGTH = 1000/);
    expect(SCREEN).toMatch(/maxLength=\{MAX_COMMENT_LENGTH\}/);
    expect(SCREEN).toMatch(/const trimmedDraft = commentDraft\.trim\(\)/);
    expect(SCREEN).toMatch(/replacePostCommentCount\(postId, result\.commentCount\)/);
    expect(SCREEN).not.toMatch(/commentCount\s*[+-]\s*1/);
    expect(SCREEN).toMatch(/commentGenerationRef/);
    expect(SCREEN).toMatch(/mountedGenerationRef/);
    expect(SCREEN).toMatch(/commentCreateOperationRef/);
    expect(SCREEN).toMatch(/pendingCommentDeletesRef = useRef\(new Map\(\)\)/);
  });

  it('owns feed finalizers and rejects responses predating accepted mutations', () => {
    expect(SCREEN).toMatch(/feedOperationRef/);
    expect(SCREEN).toMatch(/feedMutationVersionRef/);
    expect(SCREEN).toMatch(/operation !== feedOperationRef\.current/);
    expect(SCREEN).toMatch(/mutationVersion !== feedMutationVersionRef\.current/);
    expect(SCREEN).toMatch(/postCreateOperationRef\.current === operation/);
  });

  it('uses single-flight pessimistic likes and server-returned state/count', () => {
    expect(SCREEN).toMatch(/pendingLikesRef\.current\.has\(post\.id\)/);
    expect(SCREEN).toMatch(/await setCommunityPostLiked/);
    expect(SCREEN).toMatch(/likedByCurrentUser: state\.liked, likeCount: state\.likeCount/);
    expect(SCREEN).not.toMatch(/likeCount\s*[+-]\s*1/);
  });

  it('keeps pending like/delete ownership isolated when an old-account request settles', () => {
    expect(SCREEN).toMatch(/pendingLikesRef = useRef\(new Map\(\)\)/);
    expect(SCREEN).toMatch(/pendingDeletesRef = useRef\(new Map\(\)\)/);
    expect(SCREEN).toMatch(/pendingLikesRef\.current\.set\(post\.id, operation\)/);
    expect(SCREEN).toMatch(/pendingLikesRef\.current\.get\(post\.id\) === operation/);
    expect(SCREEN).toMatch(/pendingDeletesRef\.current\.set\(postId, operation\)/);
    expect(SCREEN).toMatch(/pendingDeletesRef\.current\.get\(postId\) === operation/);
  });

  it('shows trash for server-derived owners and removes only after confirmed delete', () => {
    expect(SCREEN).toMatch(/\{post\.isOwner && \(/);
    const awaitDelete = SCREEN.indexOf('await deleteCommunityPost');
    const removeLocal = SCREEN.indexOf('current.filter', awaitDelete);
    expect(removeLocal).toBeGreaterThan(awaitDelete);
  });

  it('guards all async state by current auth identity and implements no upload or deferred domains', () => {
    expect(SCREEN).toMatch(/ownerId = user\?\.id/);
    expect(SCREEN).toMatch(/ownerRef\.current !== requestOwner/);
    expect(SCREEN).toMatch(/feedGenerationRef/);
    expect(SCREEN).toMatch(/recipeGenerationRef/);
    expect(SCREEN).toMatch(/pendingLikesRef\.current\.clear\(\)/);
    expect(SCREEN).toMatch(/pendingDeletesRef\.current\.clear\(\)/);
    expect(SCREEN).toMatch(/generation !== feedGenerationRef\.current[\s\S]*ownerRef\.current !== ownerId/);
    expect(SCREEN).not.toMatch(/ImagePicker|launchCamera|base64|Firebase|Report|Share\.share|share-social/);
    expect(SCREEN).not.toMatch(/FavoritesContext|CollectionsContext|ReviewsContext|CookHistoryContext|MealPlanContext|ShoppingListContext/);
  });

  it('leaves loaded state intact on create, like, delete, refresh, and pagination failures', () => {
    const refreshStart = SCREEN.indexOf('const refreshFeed');
    const submitStart = SCREEN.indexOf('const submitPost');
    const likeStart = SCREEN.indexOf('const toggleLike');
    const deleteStart = SCREEN.indexOf('const removePost');
    const loadMoreStart = SCREEN.indexOf('const loadMorePosts');
    const recipeMoreStart = SCREEN.indexOf('const loadMoreRecipes');

    expect(SCREEN.slice(refreshStart, loadMoreStart).match(/setPosts/g)).toHaveLength(1);
    expect(SCREEN.slice(refreshStart, loadMoreStart)).toMatch(/Couldn’t refresh Community/);
    expect(SCREEN.slice(submitStart, likeStart).match(/setPosts/g)).toHaveLength(1);
    expect(SCREEN.slice(likeStart, deleteStart).match(/setPosts/g).length).toBeGreaterThanOrEqual(1);
    expect(SCREEN.slice(deleteStart, SCREEN.indexOf('const replacePostCommentCount')).match(/setPosts/g)).toHaveLength(1);
    expect(SCREEN.slice(loadMoreStart, recipeMoreStart).match(/setPosts/g)).toHaveLength(1);
    expect(SCREEN.slice(loadMoreStart, recipeMoreStart)).toMatch(/Couldn’t load more posts/);
  });

  it('preserves All/Following with pessimistic token-owned guarded follow state', () => {
    expect(SCREEN).toMatch(/\[FEED_ALL, 'All'\], \[FEED_FOLLOWING, 'Following'\], \[FEED_SAVED, 'Saved'\]/);
    expect(SCREEN).not.toMatch(/Trending|For You/);
    expect(SCREEN).toMatch(/pendingFollowsRef = useRef\(new Map\(\)\)/);
    expect(SCREEN).toMatch(/pendingFollowsRef\.current\.has\(authorId\)/);
    expect(SCREEN).toMatch(/await setCommunityAuthorFollowed/);
    expect(SCREEN).toMatch(/item\.author\?\.id === authorId/);
    expect(SCREEN).toMatch(/feedMutationVersionRef\.current \+= 1/);
    expect(SCREEN).toMatch(/setFeedReloadKey\(\(key\) => key \+ 1\)/);
    expect(SCREEN).toMatch(/feedModeRef\.current !== requestMode/);
    expect(SCREEN).toMatch(/screenGeneration !== mountedGenerationRef\.current/);
    expect(SERVICE).toMatch(/Invalid Community feed response/);
    expect(SERVICE).toMatch(/Invalid Community follow response/);
  });

  it('implements the frozen COMM5 Saved mode and token-owned bookmark guards', () => {
    expect(SCREEN).toMatch(/const FEED_SAVED = 'saved'/);
    expect(SCREEN).toMatch(/listSavedCommunityPosts/);
    expect(SCREEN).toMatch(/pendingBookmarksRef = useRef\(new Map\(\)\)/);
    expect(SCREEN).toMatch(/pendingBookmarksRef\.current\.get\(post\.id\) !== operation/);
    expect(SCREEN).toMatch(/ownerRef\.current !== requestOwner/);
    expect(SCREEN).toMatch(/screenGeneration !== mountedGenerationRef\.current/);
    expect(SCREEN).toMatch(/feedMutationVersionRef\.current \+= 1/);
    expect(SCREEN).toMatch(/feedModeRef\.current === FEED_SAVED/);
    expect(SCREEN).toMatch(/No saved posts yet/);
    expect(SCREEN).toMatch(/Tap the bookmark icon on a post to find it here later\./);
    expect(SCREEN).toMatch(/accessibilityLabel=\{post\.bookmarkedByCurrentUser \? 'Remove bookmark' : 'Bookmark post'\}/);
    expect(SCREEN).toMatch(/accessibilityState=\{\{ selected: post\.bookmarkedByCurrentUser/);
    expect(SERVICE).toMatch(/\/community\/posts\/saved/);
    expect(SERVICE).toMatch(/\/bookmarks/);
    expect(SERVICE).toMatch(/Invalid Community bookmark response/);
    expect(SERVICE).not.toMatch(/bookmarkCount|AsyncStorage/);
  });

  it('confines current production and Community test changes to the exact COMM5 allowlists', () => {
    const outsideAllowlist = COMM5_CHANGED_PATHS.filter((file) => !COMM5_ALLOWLIST.has(file));
    expect(outsideAllowlist).toEqual([]);
    expect(COMM5_CHANGED_PATHS).toEqual(expect.arrayContaining([
      'apps/api/src/modules/community/community-post-bookmark.model.js',
      'apps/api/src/modules/community/community-bookmark.repository.js',
      'apps/api/test/community-bookmark-mongo.test.js',
      'apps/mobile/src/api/communityService.js',
      'apps/mobile/src/screens/CommunityScreen.js',
    ]));
  });
});
