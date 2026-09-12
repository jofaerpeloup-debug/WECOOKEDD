const mongoose = require('mongoose');

const communityPostLikeSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Binary reaction: one authenticated user can contribute at most one like to
// a post. The postId prefix also backs counts and post-delete cleanup.
communityPostLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

const CommunityPostLike = mongoose.model('CommunityPostLike', communityPostLikeSchema);

module.exports = CommunityPostLike;
