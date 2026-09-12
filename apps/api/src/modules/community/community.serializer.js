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
    commentCount: 0,
    isOwner,
  };
}

module.exports = { toPublicCommunityPost, toCommunityRecipeSummary };
