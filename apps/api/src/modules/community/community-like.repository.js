const mongoose = require('mongoose');
const CommunityPostLike = require('./community-post-like.model');

function createLike(data) {
  return CommunityPostLike.create(data);
}

function deleteByPostAndUser(postId, userId) {
  return CommunityPostLike.findOneAndDelete({ postId, userId });
}

function deleteByPostId(postId) {
  return CommunityPostLike.deleteMany({ postId });
}

function countByPost(postId) {
  return CommunityPostLike.countDocuments({ postId });
}

// One aggregation supplies both authoritative counts and the current viewer's
// binary state for the entire feed page.
async function getMetadataForPosts(postIds, viewerId) {
  if (postIds.length === 0) return [];
  const ids = postIds.map((id) =>
    id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)
  );
  const viewer =
    viewerId instanceof mongoose.Types.ObjectId
      ? viewerId
      : new mongoose.Types.ObjectId(viewerId);

  return CommunityPostLike.aggregate([
    { $match: { postId: { $in: ids } } },
    {
      $group: {
        _id: '$postId',
        likeCount: { $sum: 1 },
        likedByCurrentUser: {
          $max: { $cond: [{ $eq: ['$userId', viewer] }, true, false] },
        },
      },
    },
  ]);
}

module.exports = {
  createLike,
  deleteByPostAndUser,
  deleteByPostId,
  countByPost,
  getMetadataForPosts,
};
