const CommunityPost = require('./community-post.model');

function createPost(data) {
  return CommunityPost.create(data);
}

function findById(id) {
  return CommunityPost.findById(id);
}

function findMany({ skip, limit }) {
  return CommunityPost.find({}).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit);
}

function countPosts() {
  return CommunityPost.countDocuments({});
}

function findManyByAuthorIds(authorIds, { skip, limit }) {
  return CommunityPost.find({ authorId: { $in: authorIds } })
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit);
}

function countPostsByAuthorIds(authorIds) {
  return CommunityPost.countDocuments({ authorId: { $in: authorIds } });
}

// Ownership and lookup are one atomic database predicate. A post owned by a
// different user is indistinguishable from a missing post.
function deleteOwnedById(postId, authorId) {
  return CommunityPost.findOneAndDelete({ _id: postId, authorId });
}

module.exports = {
  createPost,
  findById,
  findMany,
  countPosts,
  findManyByAuthorIds,
  countPostsByAuthorIds,
  deleteOwnedById,
};
