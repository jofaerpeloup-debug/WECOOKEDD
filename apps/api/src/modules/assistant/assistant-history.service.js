const crypto = require('node:crypto');
const mongoose = require('mongoose');
const repository = require('./assistant-history.repository');
const { toConversation, toMessage } = require('./assistant-history.serializer');
const { loadEnv } = require('../../config/env');
const { AppError } = require('../../shared/errors/app-error');

function notFound() {
  return new AppError('Conversation not found.', { statusCode: 404, code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
}
function invalidCursor() {
  return new AppError('Request validation failed.', { statusCode: 400, code: 'VALIDATION_ERROR' });
}

function createHistoryService({ repo = repository, now = () => new Date(),
  getSecret = () => loadEnv().jwtAccessSecret } = {}) {
  function isLive(row) { return row && new Date(row.expiresAt).getTime() > now().getTime(); }
  function guardConversation(row) { if (!isLive(row)) throw notFound(); }
  function scope(userId, endpoint, conversationId = null) {
    // Bind scope without putting an owner's raw ID in the opaque wire token.
    return crypto.createHmac('sha256', getSecret())
      .update(JSON.stringify(['assistant-history', String(userId), endpoint, conversationId])).digest('base64url');
  }
  function encodeCursor(boundary, binding) {
    const value = { v: 1, s: binding, ...boundary };
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    const signature = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }
  function decodeCursor(cursor, binding, endpoint) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 1000) throw new Error();
      const parts = cursor.split('.');
      if (parts.length !== 2) throw new Error();
      const [payload, signature] = parts;
      const actual = Buffer.from(signature, 'base64url');
      const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest();
      if (actual.toString('base64url') !== signature || actual.length !== expected.length
        || !crypto.timingSafeEqual(actual, expected)) throw new Error();
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!parsed || parsed.v !== 1 || parsed.s !== binding) throw new Error();
      const keys = endpoint === 'list' ? 'v,s,c,i' : 'v,s,q';
      if (Object.keys(parsed).join(',') !== keys
        || Buffer.from(JSON.stringify(parsed)).toString('base64url') !== payload) throw new Error();
      if (endpoint === 'list') {
        if (typeof parsed.c !== 'string' || typeof parsed.i !== 'string') throw new Error();
        const createdAt = new Date(parsed.c);
        if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== parsed.c
          || !/^[a-f0-9]{24}$/.test(parsed.i)) throw new Error();
        return { createdAt, id: new mongoose.Types.ObjectId(parsed.i) };
      }
      if (!Number.isSafeInteger(parsed.q) || parsed.q < 0) throw new Error();
      return { sequence: parsed.q };
    } catch { throw invalidCursor(); }
  }

  function guardList(data, userId) {
    const conversations = data.conversations.filter(isLive);
    const hasMore = data.pageInfo.hasMore && conversations.length === data.conversations.length;
    return { conversations, pageInfo: {
      hasMore, nextCursor: hasMore && conversations.length ? encodeCursor({
        c: conversations[conversations.length - 1].createdAt,
        i: conversations[conversations.length - 1].id,
      }, scope(userId, 'list')) : null,
    } };
  }

  async function create({ userId, requestId }) {
    const result = await repo.createConversation({ userId, requestId, now: now() });
    guardConversation(result.row);
    return { conversation: toConversation(result.row), created: result.created };
  }
  async function list({ userId, limit = 20, cursor }) {
    const binding = scope(userId, 'list');
    const boundary = cursor ? decodeCursor(cursor, binding, 'list') : null;
    const rows = await repo.findConversations({ userId, limit, cursor: boundary, now: now() });
    const liveRows = rows.filter(isLive);
    const hasMore = liveRows.length > limit;
    return guardList({ conversations: liveRows.slice(0, limit).map(toConversation),
      pageInfo: { hasMore } }, userId);
  }
  async function open({ userId, conversationId, limit = 20, cursor }) {
    const binding = scope(userId, 'open', String(conversationId).toLowerCase());
    const boundary = cursor ? decodeCursor(cursor, binding, 'open') : null;
    const parent = await repo.findConversation({ userId, conversationId, now: now() });
    guardConversation(parent);
    const rows = await repo.findMessages({ userId, conversationId, expiresAt: parent.expiresAt,
      limit, cursor: boundary, now: now() });
    // Re-read to fence concurrent deletion, and use fresh time after every await.
    const current = await repo.findConversation({ userId, conversationId, now: now() });
    guardConversation(current);
    const eligible = rows.filter((row) => isLive(row)
      && new Date(row.expiresAt).getTime() === new Date(current.expiresAt).getTime());
    const hasMore = eligible.length > limit;
    const page = eligible.slice(0, limit);
    const nextCursor = hasMore ? encodeCursor({ q: page[page.length - 1].sequence }, binding) : null;
    guardConversation(current);
    return { conversation: toConversation(current), messages: page.map(toMessage).reverse(),
      pageInfo: { nextCursor, hasMore } };
  }
  async function remove({ userId, conversationId }) {
    const deleted = await repo.deleteConversation({ userId, conversationId, now });
    guardConversation(deleted);
    return { deleted: true };
  }
  return { create, list, open, remove, guardConversation, guardList };
}

module.exports = { createHistoryService, ...createHistoryService() };
