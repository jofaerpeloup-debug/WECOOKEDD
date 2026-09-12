// Built field-by-field so userId/recipeId/__v/other internals are never
// leaked, and the author is reduced to the minimum useful public identity
// (id + name) — never email/role/status/authIdentities.
function toPublicReview({ review, author }) {
  return {
    id: String(review._id),
    rating: review.rating,
    comment: review.comment ?? null,
    author: author ? { id: author.id, name: author.name } : null,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

// Passthrough shape kept as its own function (rather than inlined at the
// controller) so the response contract has one definition. averageRating is
// null (never a fabricated 0) when ratingCount is 0.
function toRatingSummary(summary) {
  return { averageRating: summary.averageRating, ratingCount: summary.ratingCount };
}

module.exports = { toPublicReview, toRatingSummary };
