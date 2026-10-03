const mongoose = require('mongoose');
const CommunityComment = require('./community-comment.model');

function createComment(data) {
  return CommunityComment.create(data);
}

function findManyByPostId(postId, { skip, limit }) {
  return CommunityComment.find({ postId })
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit);
}

function countByPostId(postId) {
  return CommunityComment.countDocuments({ postId });
}

async function getCountsForPosts(postIds) {
  if (postIds.length === 0) return [];
  const ids = postIds.map((id) =>
    id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)
  );
  return CommunityComment.aggregate([
    { $match: { postId: { $in: ids } } },
    { $group: { _id: '$postId', commentCount: { $sum: 1 } } },
  ]);
}

function deleteOwnedById(commentId, authorId) {
  return CommunityComment.findOneAndDelete({ _id: commentId, authorId });
}

function deleteById(commentId) {
  return CommunityComment.findOneAndDelete({ _id: commentId });
}

function deleteByPostId(postId) {
  return CommunityComment.deleteMany({ postId });
}

module.exports = {
  createComment,
  findManyByPostId,
  countByPostId,
  getCountsForPosts,
  deleteOwnedById,
  deleteById,
  deleteByPostId,
};
