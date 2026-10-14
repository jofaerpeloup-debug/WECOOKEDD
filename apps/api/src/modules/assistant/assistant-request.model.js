const mongoose = require('mongoose');

// Generation is implemented in AI2-B. This schema reserves bounded, private
// attempt records; AI2-A never creates an attempt or calls generation.
const replayMessage = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
}, { _id: false, strict: 'throw' });
const outcome = new mongoose.Schema({
  code: { type: String, required: true, enum: [
    'ASSISTANT_NOT_CONFIGURED', 'ASSISTANT_UNAVAILABLE', 'ASSISTANT_TIMEOUT', 'ASSISTANT_SEND_UNCERTAIN',
  ] },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  requestId: { type: String, required: true, immutable: true },
  fingerprint: { type: String, required: true, maxlength: 64, immutable: true },
  userMessageId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  assistantMessageId: { type: mongoose.Schema.Types.ObjectId },
  replaySnapshot: { type: [replayMessage], required: true, default: undefined, immutable: true,
    validate: (items) => Array.isArray(items) && items.length >= 1 && items.length <= 12
      && items[items.length - 1].role === 'user'
      && items.every((item) => typeof item.content === 'string' && item.content === item.content.trim()
        && item.content.length > 0 && item.content.length <= (item.role === 'user' ? 2000 : 4000))
      && items.reduce((sum, item) => sum + item.content.length, 0) <= 12000 },
  fence: { type: String, required: true },
  claimExpiresAt: { type: Date, required: true },
  state: { type: String, required: true, enum: ['pending', 'complete', 'failed', 'uncertain'] },
  safeOutcome: { type: outcome },
  createdAt: { type: Date, required: true, immutable: true, default: Date.now },
  expiresAt: { type: Date, required: true, immutable: true },
}, { strict: 'throw', versionKey: false });
schema.index({ userId: 1, conversationId: 1, requestId: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AssistantRequest', schema);
