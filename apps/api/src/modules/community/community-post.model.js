const mongoose = require('mongoose');

const CAPTION_MAX_LENGTH = 2000;

const communityPostSchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    caption: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: CAPTION_MAX_LENGTH,
    },
    recipeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recipe' },
  },
  { timestamps: true }
);

// Global feed order is fixed and deterministic: newest timestamp first, then
// newest ObjectId when two posts share a timestamp.
communityPostSchema.index({ createdAt: -1, _id: -1 });

const CommunityPost = mongoose.model('CommunityPost', communityPostSchema);

module.exports = CommunityPost;
module.exports.CAPTION_MAX_LENGTH = CAPTION_MAX_LENGTH;
