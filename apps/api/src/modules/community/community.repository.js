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

// Ownership and lookup are one atomic database predicate. A post owned by a
// different user is indistinguishable from a missing post.
function deleteOwnedById(postId, authorId) {
  return CommunityPost.findOneAndDelete({ _id: postId, authorId });
}

module.exports = { createPost, findById, findMany, countPosts, deleteOwnedById };
