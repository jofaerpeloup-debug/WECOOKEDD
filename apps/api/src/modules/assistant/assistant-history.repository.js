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

function notFound() {
  return new AppError('Conversation not found.', { statusCode: 404, code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
}
function conflict(code) {
  return new AppError('Refresh the conversation before sending again.', { statusCode: 409, code });
}
function childFilter({ userId, conversationId }, parent, now) {
  return { userId, conversationId, expiresAt: { $eq: parent.expiresAt, $gt: now() }, ...databaseDeadline() };
}
function parentFilter(input, parent, now) {
  return { _id: input.conversationId, userId: input.userId, version: parent.version,
    expiresAt: { $eq: parent.expiresAt, $gt: now() }, ...databaseDeadline() };
}
async function transaction(callback) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      // Never carry an aborted callback's result into commit recovery.
      result = undefined;
      result = await callback(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally { await session.endSession(); }
}

async function recoverInTransaction(input, parent, session, now) {
  if (!parent.claim || +parent.claim.expiresAt > +now()) return parent;
  const filter = { ...childFilter(input, parent, now), requestId: parent.claim.requestId,
    fence: parent.claim.fence, state: 'pending' };
  const attempt = await Request.findOne(filter).session(session).lean();
  if (!attempt) throw conflict('ASSISTANT_SEND_UNCERTAIN');
  const result = await Request.updateOne(filter, { $set: {
    state: 'uncertain', safeOutcome: { code: 'ASSISTANT_SEND_UNCERTAIN' },
  } }, { session });
  if (result.modifiedCount !== 1) throw conflict('ASSISTANT_SEND_UNCERTAIN');
  const message = await Message.updateOne({ ...childFilter(input, parent, now),
    _id: attempt.userMessageId, role: 'user', status: 'pending' },
  { $set: { status: 'uncertain' } }, { session });
  if (message.modifiedCount !== 1) throw conflict('ASSISTANT_SEND_UNCERTAIN');
  // The last write locks the same parent as Delete and every generation.
  const recovered = await Conversation.findOneAndUpdate({
    ...parentFilter(input, parent, now), 'claim.fence': parent.claim.fence,
    'claim.requestId': parent.claim.requestId,
    $expr: { $and: [databaseDeadline().$expr, { $lte: ['$claim.expiresAt', '$$NOW'] }] },
  }, { $set: { claim: null, updatedAt: now() }, $inc: { version: 1 } },
  { session, new: true }).lean();
  if (!recovered) throw notFound();
  return recovered;
}

async function recoverClaim({ userId, conversationId, now }) {
  return transaction(async (session) => {
    const parent = await Conversation.findOne({ _id: conversationId,
      ...liveFilter(userId, now()), ...databaseDeadline() }).session(session).lean();
    if (!parent) throw notFound();
    return recoverInTransaction({ userId, conversationId }, parent, session, now);
  });
}

async function claimGeneration(input) {
  const { userId, conversationId, requestId, expectedVersion, content, retryOf,
    fingerprint, fence, userMessageId, assistantMessageId, claimDurationMs, buildReplay, now } = input;
  return transaction(async (session) => {
    let parent = await Conversation.findOne({ _id: conversationId,
      ...liveFilter(userId, now()), ...databaseDeadline() }).session(session).lean();
    if (!parent) throw notFound();
    const owned = () => childFilter(input, parent, now);
    const existing = await Request.findOne({ ...owned(), requestId }).session(session).lean();
    // Request identity takes precedence over an obsolete version, after expiry.
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw conflict('ASSISTANT_REQUEST_CONFLICT');
      return { accepted: false };
    }
    if (parent.version !== expectedVersion) throw conflict('ASSISTANT_CONVERSATION_STALE');
    if (parent.claim) throw conflict('ASSISTANT_REQUEST_IN_PROGRESS');
    if (!Number.isSafeInteger(parent.version + 2) || !Number.isSafeInteger(parent.nextSequence + 2)) {
      throw conflict('ASSISTANT_CONVERSATION_STALE');
    }
    let userMessage;
    let replaySnapshot;
    if (retryOf) {
      userMessage = await Message.findOne({ ...owned(), _id: retryOf, role: 'user' }).session(session).lean();
      if (!userMessage) throw notFound();
      const latestUser = await Message.findOne({ ...owned(), role: 'user' })
        .sort({ sequence: -1 }).session(session).lean();
      const latestAttempt = await Request.findOne({ ...owned(), userMessageId: userMessage._id })
        .sort({ createdAt: -1, _id: -1 }).session(session).lean();
      if (userMessage.status !== 'failed' || String(latestUser?._id) !== String(userMessage._id)
        || latestAttempt?.state !== 'failed') throw conflict('ASSISTANT_REQUEST_CONFLICT');
      replaySnapshot = latestAttempt.replaySnapshot.map(({ role, content: text }) => ({ role, content: text }));
      const updated = await Message.updateOne({ ...owned(), _id: userMessage._id, status: 'failed' },
        { $set: { status: 'pending' } }, { session });
      if (updated.modifiedCount !== 1) throw conflict('ASSISTANT_REQUEST_CONFLICT');
      userMessage = { ...userMessage, status: 'pending' };
    } else {
      // Eleven preceding messages suffice for the bounded twelve-message suffix.
      const history = await Message.find(owned()).sort({ sequence: -1 }).limit(11).session(session).lean();
      userMessage = { _id: userMessageId, userId, conversationId, role: 'user', content,
        sequence: parent.nextSequence, createdAt: now(), expiresAt: parent.expiresAt, status: 'pending' };
      replaySnapshot = buildReplay([...history.reverse(), userMessage]);
      await Message.create([userMessage], { session });
    }
    const claimExpiresAt = new Date(Math.min(+parent.expiresAt, +now() + claimDurationMs));
    const attempt = { userId, conversationId, requestId, fingerprint,
      userMessageId: userMessage._id, assistantMessageId, replaySnapshot, fence,
      claimExpiresAt, state: 'pending', createdAt: now(), expiresAt: parent.expiresAt };
    await Request.create([attempt], { session });
    const claimed = await Conversation.findOneAndUpdate({ ...parentFilter(input, parent, now), claim: null },
      { $set: { claim: { requestId, fence, expiresAt: claimExpiresAt }, updatedAt: now() },
        $inc: { version: 1, nextSequence: retryOf ? 0 : 2 } }, { session, new: true }).lean();
    if (!claimed) throw notFound();
    return { accepted: true, parent: claimed, request: attempt, userMessage };
  });
}

async function getGeneration({ userId, conversationId, requestId, now }) {
  const input = { userId, conversationId };
  const parent = await findConversation({ ...input, now: now() });
  if (!parent) throw notFound();
  const attempt = await Request.findOne({ ...childFilter(input, parent, now), requestId }).lean();
  if (!attempt) {
    const current = await findConversation({ ...input, now: now() });
    if (!current || +current.expiresAt <= +now()) throw notFound();
    return null;
  }
  const userMessage = await Message.findOne({ ...childFilter(input, parent, now), _id: attempt.userMessageId }).lean();
  const assistantMessage = attempt.state === 'complete'
    ? await Message.findOne({ ...childFilter(input, parent, now), _id: attempt.assistantMessageId, role: 'assistant' }).lean()
    : null;
  const current = await findConversation({ ...input, now: now() });
  if (!current || +current.expiresAt !== +parent.expiresAt || +current.expiresAt <= +now()) throw notFound();
  if (!userMessage || (attempt.state === 'complete' && !assistantMessage)) throw conflict('ASSISTANT_SEND_UNCERTAIN');
  return { parent: current, request: attempt, userMessage, assistantMessage };
}

async function finishGeneration({ userId, conversationId, requestId, fence, version, expiresAt,
  reply, safeOutcome, now }) {
  const input = { userId, conversationId };
  return transaction(async (session) => {
    const parent = await Conversation.findOne({ _id: conversationId, ...liveFilter(userId, now()),
      ...databaseDeadline() }).session(session).lean();
    if (!parent || +parent.expiresAt !== +expiresAt) throw notFound();
    if (parent.version !== version || parent.claim?.fence !== fence || parent.claim?.requestId !== requestId) {
      throw conflict('ASSISTANT_SEND_UNCERTAIN');
    }
    const owned = () => childFilter(input, parent, now);
    const requestFilter = { ...owned(), requestId, fence, state: 'pending' };
    const attempt = await Request.findOne(requestFilter).session(session).lean();
    const userMessage = attempt && await Message.findOne({ ...owned(), _id: attempt.userMessageId,
      role: 'user', status: 'pending' }).session(session).lean();
    if (!userMessage) throw conflict('ASSISTANT_SEND_UNCERTAIN');
    const state = safeOutcome ? 'failed' : 'complete';
    if (!safeOutcome) await Message.create([{ _id: attempt.assistantMessageId, userId, conversationId,
      role: 'assistant', content: reply, sequence: userMessage.sequence + 1,
      createdAt: now(), expiresAt: parent.expiresAt }], { session });
    const requestWrite = await Request.updateOne(requestFilter,
      { $set: { state, ...(safeOutcome ? { safeOutcome: { code: safeOutcome } } : {}) } }, { session });
    const messageWrite = await Message.updateOne({ ...owned(), _id: userMessage._id, status: 'pending' },
      { $set: { status: state } }, { session });
    if (requestWrite.modifiedCount !== 1 || messageWrite.modifiedCount !== 1) throw notFound();
    // A failed final fence aborts every child write, even a generated reply.
    const finished = await Conversation.findOneAndUpdate({ ...parentFilter(input, parent, now),
      'claim.fence': fence, 'claim.requestId': requestId },
    { $set: { claim: null, updatedAt: now() }, $inc: { version: 1 } }, { session, new: true }).lean();
    if (!finished) throw notFound();
  });
}

module.exports = { createConversation, findConversation, findConversations, findMessages, deleteConversation,
  claimGeneration, getGeneration, finishGeneration, recoverClaim };
