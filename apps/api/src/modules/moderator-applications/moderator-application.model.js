const mongoose = require('mongoose');

const APPLICATION_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);
const REJECTION_REASON_MAX_LENGTH = 500;

const moderatorApplicationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: APPLICATION_STATUSES,
      default: 'pending',
      required: true,
    },
    reviewedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: REJECTION_REASON_MAX_LENGTH,
      default: null,
    },
  },
  { timestamps: true }
);

// At most one live application per user. Terminal history remains unlimited.
moderatorApplicationSchema.index(
  { userId: 1 },
  {
    name: 'uniq_pending_moderator_application_per_user',
    unique: true,
    partialFilterExpression: { status: 'pending' },
  }
);
moderatorApplicationSchema.index(
  { status: 1, createdAt: -1, _id: -1 },
  { name: 'moderator_application_queue' }
);

const ModeratorApplication = mongoose.model(
  'ModeratorApplication',
  moderatorApplicationSchema
);

module.exports = ModeratorApplication;
module.exports.APPLICATION_STATUSES = APPLICATION_STATUSES;
module.exports.REJECTION_REASON_MAX_LENGTH = REJECTION_REASON_MAX_LENGTH;
