const User = require('../users/user.model');
const CommunityPost = require('../community/community-post.model');

const OPTIONS = Object.freeze({ maxTimeMS: 2000, allowDiskUse: false });

async function aggregateOne(Model, pipeline) {
  const rows = await Model.aggregate(pipeline).option(OPTIONS);
  return rows[0] || null;
}

function sumWhen(field, value) {
  return { $sum: { $cond: [{ $eq: [`$${field}`, value] }, 1, 0] } };
}

async function accountSnapshot() {
  return aggregateOne(User, [{
    $group: {
      _id: null,
      total: { $sum: 1 },
      user: sumWhen('role', 'user'),
      moderator: sumWhen('role', 'moderator'),
      admin: sumWhen('role', 'admin'),
      active: sumWhen('status', 'active'),
      suspended: sumWhen('status', 'suspended'),
      eligibleActive: {
        $sum: {
          $cond: [{ $and: [
            { $eq: ['$status', 'active'] },
            { $eq: [{ $ifNull: ['$deactivatedAt', null] }, null] },
          ] }, 1, 0],
        },
      },
    },
  }]);
}

async function postSnapshot() {
  return aggregateOne(CommunityPost, [{ $group: { _id: null, total: { $sum: 1 } } }]);
}

function periodPipeline(from, to) {
  return [
    { $match: { createdAt: { $gte: from.days90, $lt: to } } },
    // Query $type matches Date elements inside arrays; aggregation $type checks
    // the field itself. Keep the bounded range first for index eligibility.
    { $match: { $expr: { $eq: [{ $type: '$createdAt' }, 'date'] } } },
    { $group: {
      _id: null,
      days7: { $sum: { $cond: [{ $gte: ['$createdAt', from.days7] }, 1, 0] } },
      days30: { $sum: { $cond: [{ $gte: ['$createdAt', from.days30] }, 1, 0] } },
      days90: { $sum: 1 },
    } },
  ];
}

function accountPeriods(from, to) {
  return aggregateOne(User, periodPipeline(from, to));
}

function postPeriods(from, to) {
  return aggregateOne(CommunityPost, periodPipeline(from, to));
}

module.exports = { accountSnapshot, postSnapshot, accountPeriods, postPeriods };
