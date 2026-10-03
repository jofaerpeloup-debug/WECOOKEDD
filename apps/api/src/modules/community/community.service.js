const communityRepository = require('./community.repository');
const communityLikeRepository = require('./community-like.repository');
const communityCommentRepository = require('./community-comment.repository');
const recipeService = require('../recipes/recipe.service');
const userService = require('../users/user.service');
const { AppError } = require('../../shared/errors/app-error');

const DUPLICATE_KEY_ERROR_CODE = 11000;

function postNotFoundError() {
  return new AppError('Community post not found.', {
    statusCode: 404,
    code: 'COMMUNITY_POST_NOT_FOUND',
  });
}

function recipeNotFoundError() {
  return new AppError('Recipe not found.', { statusCode: 404, code: 'RECIPE_NOT_FOUND' });
}

function commentNotFoundError() {
  return new AppError('Community comment not found.', {
    statusCode: 404,
    code: 'COMMUNITY_COMMENT_NOT_FOUND',
  });
}

async function resolvePage(posts, viewerId) {
  const authorIds = [...new Set(posts.map((post) => String(post.authorId)))];
  const recipeIds = [
    ...new Set(posts.filter((post) => post.recipeId).map((post) => String(post.recipeId))),
  ];

  const [authors, recipes, likeMetadata, commentCounts] = await Promise.all([
    userService.getPublicUsersByIds(authorIds),
    Promise.all(
      recipeIds.map(async (recipeId) => ({
        recipeId,
        recipe: await recipeService.findUsableRecipeById(recipeId),
      }))
    ),
    communityLikeRepository.getMetadataForPosts(
      posts.map((post) => post._id),
      viewerId
    ),
    communityCommentRepository.getCountsForPosts(posts.map((post) => post._id)),
  ]);

  const authorsById = new Map(authors.map((author) => [author.id, author]));
  const recipesById = new Map(recipes.map((entry) => [entry.recipeId, entry.recipe]));
  const likesByPostId = new Map(
    likeMetadata.map((entry) => [
      String(entry._id),
      {
        likeCount: entry.likeCount,
        likedByCurrentUser: entry.likedByCurrentUser === true,
      },
    ])
  );
  const commentsByPostId = new Map(
    commentCounts.map((entry) => [String(entry._id), entry.commentCount])
  );

  return posts.map((post) => {
    const recipeId = post.recipeId ? String(post.recipeId) : null;
    const recipe = recipeId ? recipesById.get(recipeId) || null : null;
    const likes = likesByPostId.get(String(post._id)) || {
      likeCount: 0,
      likedByCurrentUser: false,
    };

    return {
      post,
      author: authorsById.get(String(post.authorId)) || null,
      recipeAttachment:
        recipeId === null ? null : { isAvailable: recipe !== null, recipe },
      ...likes,
      commentCount: commentsByPostId.get(String(post._id)) || 0,
      isOwner: String(post.authorId) === String(viewerId),
    };
  });
}

async function listPosts({ viewerId, page, limit }) {
  const skip = (page - 1) * limit;
  const [posts, total] = await Promise.all([
    communityRepository.findMany({ skip, limit }),
    communityRepository.countPosts(),
  ]);
  return { items: await resolvePage(posts, viewerId), total, page, limit };
}

async function createPost(authorId, { caption, recipeId }) {
  let recipe = null;
  if (recipeId) {
    recipe = await recipeService.findUsableRecipeById(recipeId);
    if (!recipe) throw recipeNotFoundError();
  }

  const post = await communityRepository.createPost({
    authorId,
    caption,
    ...(recipeId ? { recipeId } : {}),
  });
  const [author] = await userService.getPublicUsersByIds([authorId]);

  return {
    post,
    author: author || null,
    recipeAttachment: recipeId ? { isAvailable: true, recipe } : null,
    likeCount: 0,
    likedByCurrentUser: false,
    commentCount: 0,
    isOwner: true,
  };
}

async function deletePost(authorId, postId) {
  const deleted = await communityRepository.deleteOwnedById(postId, authorId);
  if (!deleted) throw postNotFoundError();
  await Promise.all([
    communityLikeRepository.deleteByPostId(deleted._id),
    communityCommentRepository.deleteByPostId(deleted._id),
  ]);
  return deleted;
}

async function assertPostExists(postId) {
  const post = await communityRepository.findById(postId);
  if (!post) throw postNotFoundError();
  return post;
}

async function likePost(userId, postId) {
  await assertPostExists(postId);
  try {
    await communityLikeRepository.createLike({ postId, userId });
  } catch (error) {
    // POST expresses the desired state, so both an existing row and a
    // concurrent unique-index race are deterministic success.
    if (!error || error.code !== DUPLICATE_KEY_ERROR_CODE) throw error;
  }
  // Close the create-vs-delete race: if deletion landed after the first
  // existence check, remove this viewer's relation so no orphan survives.
  const stillExists = await communityRepository.findById(postId);
  if (!stillExists) {
    await communityLikeRepository.deleteByPostAndUser(postId, userId);
    throw postNotFoundError();
  }
  return { liked: true, likeCount: await communityLikeRepository.countByPost(postId) };
}

async function unlikePost(userId, postId) {
  await assertPostExists(postId);
  await communityLikeRepository.deleteByPostAndUser(postId, userId);
  return { liked: false, likeCount: await communityLikeRepository.countByPost(postId) };
}


async function resolveComments(comments, viewerId) {
  const authorIds = [...new Set(comments.map((comment) => String(comment.authorId)))];
  const authors = await userService.getPublicUsersByIds(authorIds);
  const authorsById = new Map(authors.map((author) => [author.id, author]));
  return comments.map((comment) => ({
    comment,
    author: authorsById.get(String(comment.authorId)) || null,
    isOwner: String(comment.authorId) === String(viewerId),
  }));
}

async function listComments({ viewerId, postId, page, limit }) {
  await assertPostExists(postId);
  const skip = (page - 1) * limit;
  const [comments, total] = await Promise.all([
    communityCommentRepository.findManyByPostId(postId, { skip, limit }),
    communityCommentRepository.countByPostId(postId),
  ]);
  return { items: await resolveComments(comments, viewerId), total, page, limit };
}

async function createComment(authorId, postId, { body }) {
  await assertPostExists(postId);
  const comment = await communityCommentRepository.createComment({ postId, authorId, body });
  const stillExists = await communityRepository.findById(postId);
  if (!stillExists) {
    await communityCommentRepository.deleteById(comment._id);
    throw postNotFoundError();
  }
  const [author, commentCount] = await Promise.all([
    userService.getPublicUsersByIds([authorId]).then((authors) => authors[0] || null),
    communityCommentRepository.countByPostId(postId),
  ]);
  return {
    item: { comment, author, isOwner: true },
    commentCount,
  };
}

async function deleteComment(authorId, commentId) {
  const deleted = await communityCommentRepository.deleteOwnedById(commentId, authorId);
  if (!deleted) throw commentNotFoundError();
  return {
    deleted: true,
    commentCount: await communityCommentRepository.countByPostId(deleted.postId),
  };
}

module.exports = {
  listPosts,
  createPost,
  deletePost,
  likePost,
  unlikePost,
  listComments,
  createComment,
  deleteComment,
  resolvePage,
  resolveComments,
};
