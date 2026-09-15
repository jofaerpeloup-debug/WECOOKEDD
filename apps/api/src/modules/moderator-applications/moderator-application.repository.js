const ModeratorApplication = require('./moderator-application.model');

function createPending(userId) {
  return ModeratorApplication.create({ userId });
}

function findPendingByUserId(userId) {
  return ModeratorApplication.findOne({ userId, status: 'pending' });
}

function findLatestByUserId(userId) {
  return ModeratorApplication.findOne({ userId }).sort({ createdAt: -1, _id: -1 });
}

function findById(id) {
  return ModeratorApplication.findById(id);
}

function findManyForAdmin({ status, skip, limit }) {
  return ModeratorApplication.find({ status })
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .populate({ path: 'userId', select: '_id name email emailVerified role status' });
}

function countByStatus(status) {
  return ModeratorApplication.countDocuments({ status });
}

function approvePending(id, { reviewedAt, reviewedBy }) {
  return ModeratorApplication.findOneAndUpdate(
    { _id: id, status: 'pending' },
    {
      $set: {
        status: 'approved',
        reviewedAt,
        reviewedBy,
        rejectionReason: null,
      },
    },
    { new: true, runValidators: true }
  );
}

function rejectPending(id, { reviewedAt, reviewedBy, rejectionReason }) {
  return ModeratorApplication.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status: 'rejected', reviewedAt, reviewedBy, rejectionReason } },
    { new: true, runValidators: true }
  );
}

// Exact-decision predicate prevents one failed approver from undoing another
// decision. This is compensation only; it never grants authority.
function rollbackApproval(id, { reviewedAt, reviewedBy }) {
  return ModeratorApplication.findOneAndUpdate(
    { _id: id, status: 'approved', reviewedAt, reviewedBy },
    {
      $set: {
        status: 'pending',
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
      },
    },
    { new: true, runValidators: true }
  );
}

module.exports = {
  createPending,
  findPendingByUserId,
  findLatestByUserId,
  findById,
  findManyForAdmin,
  countByStatus,
  approvePending,
  rejectPending,
  rollbackApproval,
};
