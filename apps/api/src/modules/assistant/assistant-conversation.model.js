const mongoose = require('mongoose');

const RETENTION_MS = 2_592_000_000;
const integer = { type: Number, min: 0, validate: Number.isSafeInteger, default: 0 };
const claimSchema = new mongoose.Schema({
  requestId: { type: String, required: true },
  fence: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  createRequestId: { type: String, required: true, immutable: true },
  createdAt: { type: Date, required: true, immutable: true, default: Date.now },
  updatedAt: { type: Date, required: true, default: Date.now },
  expiresAt: { type: Date, required: true, immutable: true },
  version: integer,
  nextSequence: integer,
  claim: { type: claimSchema, default: null },
}, { strict: 'throw', versionKey: false });
schema.pre('validate', function enforceDeadline() {
  if (!this.createdAt || !Number.isFinite(this.createdAt.getTime())) return;
  const deadline = new Date(this.createdAt.getTime() + RETENTION_MS);
  if (this.isNew && !this.expiresAt) this.expiresAt = deadline;
  if (this.expiresAt?.getTime() !== deadline.getTime()) {
    this.invalidate('expiresAt', 'Expiry must equal creation plus 30 elapsed days.');
  }
});
schema.index({ userId: 1, createRequestId: 1 }, { unique: true });
schema.index({ userId: 1, createdAt: -1, _id: -1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AssistantConversation', schema);
module.exports.RETENTION_MS = RETENTION_MS;
