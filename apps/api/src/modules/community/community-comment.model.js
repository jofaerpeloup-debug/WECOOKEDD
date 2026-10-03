const mongoose = require('mongoose');

const COMMENT_MAX_LENGTH = 1000;

const communityCommentSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost', required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: COMMENT_MAX_LENGTH,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

communityCommentSchema.index({ postId: 1, createdAt: -1, _id: -1 });

const CommunityComment = mongoose.model('CommunityComment', communityCommentSchema);

module.exports = CommunityComment;
module.exports.COMMENT_MAX_LENGTH = COMMENT_MAX_LENGTH;
