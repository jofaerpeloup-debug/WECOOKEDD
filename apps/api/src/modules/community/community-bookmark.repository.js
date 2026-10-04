const mongoose = require('mongoose');
const CommunityPostBookmark = require('./community-post-bookmark.model');
const CommunityPost = require('./community-post.model');

function createBookmark(data) {
  return CommunityPostBookmark.create(data);
}

function deleteByPostAndUser(postId, userId) {
  return CommunityPostBookmark.findOneAndDelete({ postId, userId });
}

function deleteByPostId(postId) {
  return CommunityPostBookmark.deleteMany({ postId });
}

async function findBookmarkedPostIdsAmong(userId, postIds) {
  if (postIds.length === 0) return [];
  const rows = await CommunityPostBookmark.find({ userId, postId: { $in: postIds } }).select('postId');
  return rows.map((row) => row.postId);
}

async function findSavedPosts(userId, { skip, limit }) {
  const [result = { items: [], metadata: [] }] = await CommunityPostBookmark.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    {
      $lookup: {
        from: CommunityPost.collection.name,
        localField: 'postId',
        foreignField: '_id',
        as: 'post',
      },
    },
    { $unwind: '$post' },
    { $replaceRoot: { newRoot: '$post' } },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: limit }],
        metadata: [{ $count: 'total' }],
      },
    },
  ]);
  return { posts: result.items, total: result.metadata[0]?.total || 0 };
}

module.exports = {
  createBookmark,
  deleteByPostAndUser,
  deleteByPostId,
  findBookmarkedPostIdsAmong,
  findSavedPosts,
};
