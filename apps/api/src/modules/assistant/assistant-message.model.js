const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  sequence: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
  role: { type: String, enum: ['user', 'assistant'], required: true, immutable: true },
  content: { type: String, required: true, immutable: true },
  createdAt: { type: Date, required: true, immutable: true, default: Date.now },
  expiresAt: { type: Date, required: true, immutable: true },
  status: { type: String, enum: ['pending', 'complete', 'failed', 'uncertain'] },
}, { strict: 'throw', versionKey: false });
schema.pre('validate', function validateMessage() {
  if (this.role === 'user' && !this.status) this.invalidate('status', 'User status is required.');
  if (this.role === 'assistant' && this.status !== undefined) this.invalidate('status', 'Assistant status is not stored.');
  if (typeof this.content === 'string' && (!this.content.trim()
      || this.content !== this.content.trim() || (this.role === 'user' && this.content.length > 2000))) {
    this.invalidate('content', 'Invalid message content.');
  }
});
schema.index({ userId: 1, conversationId: 1, sequence: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AssistantMessage', schema);
