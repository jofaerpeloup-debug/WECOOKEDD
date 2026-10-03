function toCommunityRecipeSummary(recipe) {
  return { id: String(recipe._id), title: recipe.title, imageUrl: recipe.imageUrl ?? null };
}

// Every public field is selected explicitly. Persistence ids remain internal
// except for the safe public author id and available recipe id.
function toPublicCommunityPost({
  post,
  author,
  recipeAttachment,
  likeCount,
  likedByCurrentUser,
  commentCount,
  isOwner,
}) {
  return {
    id: String(post._id),
    caption: post.caption,
    createdAt: post.createdAt,
    author: author ? { id: author.id, name: author.name } : null,
    recipeAttachment:
      recipeAttachment === null
        ? null
        : {
            isAvailable: recipeAttachment.isAvailable,
            recipe:
              recipeAttachment.isAvailable && recipeAttachment.recipe
                ? toCommunityRecipeSummary(recipeAttachment.recipe)
                : null,
          },
    likeCount,
    likedByCurrentUser,
    commentCount,
    isOwner,
  };
}

function toPublicCommunityComment({ comment, author, isOwner }) {
  return {
    id: String(comment._id),
    body: comment.body,
    author: author ? { id: author.id, name: author.name } : null,
    createdAt: comment.createdAt,
    isOwner,
  };
}

module.exports = {
  toPublicCommunityPost,
  toPublicCommunityComment,
  toCommunityRecipeSummary,
};
