const mongoose = require('mongoose');

const communityFollowSchema = new mongoose.Schema(
  {
    followerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    followedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

communityFollowSchema.path('followedUserId').validate(function validateNotSelf(value) {
  return !this.followerId || !value || String(this.followerId) !== String(value);
}, 'Users cannot follow themselves.');

communityFollowSchema.index({ followerId: 1, followedUserId: 1 }, { unique: true });

const CommunityFollow = mongoose.model('CommunityFollow', communityFollowSchema);

module.exports = CommunityFollow;
