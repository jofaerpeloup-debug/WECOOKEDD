const CommunityFollow = require('./community-follow.model');

function createFollow(data) {
  return CommunityFollow.create(data);
}

function deleteFollow(followerId, followedUserId) {
  return CommunityFollow.findOneAndDelete({ followerId, followedUserId });
}

async function findFollowedUserIds(followerId) {
  const rows = await CommunityFollow.find({ followerId }).select('followedUserId');
  return rows.map((row) => row.followedUserId);
}

async function findFollowedUserIdsAmong(followerId, followedUserIds) {
  if (followedUserIds.length === 0) return [];
  const rows = await CommunityFollow.find({
    followerId,
    followedUserId: { $in: followedUserIds },
  }).select('followedUserId');
  return rows.map((row) => row.followedUserId);
}

module.exports = {
  createFollow,
  deleteFollow,
  findFollowedUserIds,
  findFollowedUserIdsAmong,
};
