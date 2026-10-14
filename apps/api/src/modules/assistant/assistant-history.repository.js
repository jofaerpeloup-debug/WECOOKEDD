const mongoose = require('mongoose');
const Conversation = require('./assistant-conversation.model');
const Message = require('./assistant-message.model');
const Request = require('./assistant-request.model');
const { AppError } = require('../../shared/errors/app-error');

// Server time bounds reads; Mongo's current operation time fences mutations.
function liveFilter(userId, now) { return { userId, expiresAt: { $gt: now } }; }
function databaseDeadline() { return { $expr: { $gt: ['$expiresAt', '$$NOW'] } }; }

async function createConversation({ userId, requestId, now }) {
  // Do not upsert: replay must never renew immutable dates or restore history.
  const existing = await Conversation.findOne({ userId, createRequestId: requestId }).lean();
  if (existing) return { row: existing, created: false };
  try {
    const row = await Conversation.create({
      userId, createRequestId: requestId, createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + Conversation.RETENTION_MS),
    });
    return { row: row.toObject(), created: true };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const row = await Conversation.findOne({ userId, createRequestId: requestId }).lean();
    if (!row) throw error;
    return { row, created: false };
  }
}

function findConversation({ userId, conversationId, now }) {
  return Conversation.findOne({ _id: conversationId, ...liveFilter(userId, now) }).lean();
}

function findConversations({ userId, now, cursor, limit }) {
  const filter = liveFilter(userId, now);
  if (cursor) filter.$or = [
    { createdAt: { $lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
  ];
  return Conversation.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
}

function findMessages({ userId, conversationId, expiresAt, now, cursor, limit }) {
  return Message.find({
    userId, conversationId, expiresAt: { $eq: expiresAt, $gt: now },
    ...(cursor ? { sequence: { $lt: cursor.sequence } } : {}),
  }).sort({ sequence: -1 }).limit(limit + 1).lean();
}

async function deleteConversation({ userId, conversationId, now }) {
  const session = await mongoose.startSession();
  try {
    let deleted = null;
    await session.withTransaction(async () => {
      deleted = null;
      const parent = await Conversation.findOne({
        _id: conversationId, ...liveFilter(userId, now()), ...databaseDeadline(),
      }).session(session).lean();
      if (!parent) return;
      // Delete all owned children, including expired ones, without a TTL cascade.
      await Message.deleteMany({ userId, conversationId }, { session });
      await Request.deleteMany({ userId, conversationId }, { session });
      // This is the final conditional write. Expiry while removing children
      // aborts the entire transaction; competing sends conflict on the parent.
      deleted = await Conversation.findOneAndDelete({
        _id: conversationId, userId, version: parent.version,
        expiresAt: { $eq: parent.expiresAt, $gt: now() }, ...databaseDeadline(),
      }, { session }).lean();
      if (!deleted) throw new AppError('Conversation not found.', {
        statusCode: 404, code: 'ASSISTANT_CONVERSATION_NOT_FOUND',
      });
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return deleted;
  } finally {
    await session.endSession();
  }
}

module.exports = { createConversation, findConversation, findConversations, findMessages, deleteConversation };
