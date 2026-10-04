const mongoose = require('mongoose');

const communityPostBookmarkSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

communityPostBookmarkSchema.index({ userId: 1, postId: 1 }, { unique: true });
communityPostBookmarkSchema.index({ postId: 1 });

module.exports = mongoose.model('CommunityPostBookmark', communityPostBookmarkSchema);
