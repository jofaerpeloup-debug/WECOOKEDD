const fs = require('fs');
const path = require('path');

const SCREEN = fs.readFileSync(path.join(__dirname, '../src/screens/CommunityScreen.js'), 'utf8');
const SERVICE = fs.readFileSync(path.join(__dirname, '../src/api/communityService.js'), 'utf8');

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
    expect(SCREEN).toMatch(/initialFor\(authorName\)/);
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
    expect(SCREEN).not.toMatch(/ImagePicker|launchCamera|base64|Firebase|Follow|Report|Share\.share|share-social|bookmark/);
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
    expect(SCREEN.slice(likeStart, deleteStart).match(/setPosts/g)).toHaveLength(1);
    expect(SCREEN.slice(deleteStart, SCREEN.indexOf('const replacePostCommentCount')).match(/setPosts/g)).toHaveLength(1);
    expect(SCREEN.slice(loadMoreStart, recipeMoreStart).match(/setPosts/g)).toHaveLength(1);
    expect(SCREEN.slice(loadMoreStart, recipeMoreStart)).toMatch(/Couldn’t load more posts/);
  });
});
