const crypto = require('node:crypto');
const mongoose = require('mongoose');
const repository = require('./assistant-history.repository');
const { toConversation, toMessage } = require('./assistant-history.serializer');
const { loadEnv } = require('../../config/env');
const { AppError } = require('../../shared/errors/app-error');
const assistant = require('./assistant.service');
const { PROVIDER_TIMEOUT_MS } = require('./openai.provider');

// Same normalization and contiguous suffix bounds as AI1 buildAssistantTranscript.
function buildReplay(messages) {
  const normalized = messages.map((message) => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') return null;
    const content = message.content.trim().slice(0, message.role === 'user' ? 2000 : 4000);
    return content ? { role: message.role, content } : null;
  }).filter(Boolean);
  const suffix = [];
  let total = 0;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (suffix.length === 12 || total + normalized[index].content.length > 12000) break;
    suffix.unshift(normalized[index]);
    total += normalized[index].content.length;
  }
  return suffix;
}
const outcomes = {
  ASSISTANT_NOT_CONFIGURED: [503, 'The cooking assistant is not configured.'],
  ASSISTANT_UNAVAILABLE: [503, 'The cooking assistant is temporarily unavailable.'],
  ASSISTANT_TIMEOUT: [504, 'The cooking assistant request timed out.'],
  ASSISTANT_SEND_UNCERTAIN: [409, 'Review the conversation before sending again.'],
  ASSISTANT_REQUEST_IN_PROGRESS: [409, 'A message is already being processed.'],
};
function outcomeError(code) {
  const [statusCode, message] = outcomes[code] || outcomes.ASSISTANT_SEND_UNCERTAIN;
  return new AppError(message, { statusCode, code: outcomes[code] ? code : 'ASSISTANT_SEND_UNCERTAIN' });
}
function requestFingerprint(input) {
  return crypto.createHash('sha256').update(JSON.stringify([
    input.expectedVersion, input.retryOf ? 'retry' : 'send', input.retryOf || input.content,
  ])).digest('hex');
}

function notFound() {
  return new AppError('Conversation not found.', { statusCode: 404, code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
}
function invalidCursor() {
  return new AppError('Request validation failed.', { statusCode: 400, code: 'VALIDATION_ERROR' });
}

function createHistoryService({ repo = repository, now = () => new Date(),
  getSecret = () => loadEnv().jwtAccessSecret, chat = (messages) => assistant.chat(messages),
  newId = () => new mongoose.Types.ObjectId(), newFence = () => crypto.randomUUID() } = {}) {
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
    let parent = await repo.findConversation({ userId, conversationId, now: now() });
    guardConversation(parent);
    if (parent.claim && +new Date(parent.claim.expiresAt) <= +now()) {
      parent = await repo.recoverClaim({ userId, conversationId, now });
      guardConversation(parent);
    }
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

  async function liveParent(input) {
    const parent = await repo.findConversation({ userId: input.userId, conversationId: input.conversationId, now: now() });
    guardConversation(parent);
    return parent;
  }
  function resolveGeneration(result, requestId, { ambiguous = false, fingerprint } = {}) {
    if (!result) throw outcomeError('ASSISTANT_SEND_UNCERTAIN');
    guardConversation(result.parent);
    guardConversation(result.request);
    if (+new Date(result.request.expiresAt) !== +new Date(result.parent.expiresAt)) throw notFound();
    if (fingerprint && result.request.fingerprint !== fingerprint) {
      throw new AppError('Refresh the conversation before sending again.', {
        statusCode: 409, code: 'ASSISTANT_REQUEST_CONFLICT',
      });
    }
    if (result.request.state === 'pending') {
      throw outcomeError(ambiguous ? 'ASSISTANT_SEND_UNCERTAIN' : 'ASSISTANT_REQUEST_IN_PROGRESS');
    }
    if (result.request.state !== 'complete') throw outcomeError(result.request.safeOutcome?.code);
    guardConversation(result.userMessage);
    guardConversation(result.assistantMessage);
    guardConversation(result.parent);
    return { conversation: toConversation(result.parent), requestId,
      userMessage: toMessage(result.userMessage), assistantMessage: toMessage(result.assistantMessage) };
  }
  async function reconcile(input) {
    await liveParent(input);
    const result = await repo.getGeneration({ ...input, now });
    return resolveGeneration(result, input.requestId, { ambiguous: true, fingerprint: requestFingerprint(input) });
  }
  async function send(input) {
    let parent = await liveParent(input);
    if (parent.claim && +new Date(parent.claim.expiresAt) <= +now()) {
      parent = await repo.recoverClaim({ ...input, now });
      guardConversation(parent);
    }
    const fingerprint = requestFingerprint(input);
    let claim;
    try {
      claim = await repo.claimGeneration({ ...input, fingerprint, fence: newFence(),
        userMessageId: newId(), assistantMessageId: newId(), now,
        claimDurationMs: PROVIDER_TIMEOUT_MS, buildReplay });
    } catch (error) {
      // A lost claim commit never authorizes dispatch. Resolve only durable state.
      const currentParent = await liveParent(input);
      if (error instanceof AppError) throw error;
      if (error?.code === 11000) {
        // Unique-index losers did not commit a new claim. Resolve the winner's
        // request normally, or report the now-obsolete version for another key.
        const result = await repo.getGeneration({ ...input, now });
        if (result) return resolveGeneration(result, input.requestId, { fingerprint });
        guardConversation(currentParent);
        throw new AppError('Refresh the conversation before sending again.', { statusCode: 409,
          code: currentParent.version !== input.expectedVersion
            ? 'ASSISTANT_CONVERSATION_STALE' : 'ASSISTANT_REQUEST_CONFLICT' });
      }
      return reconcile(input);
    }
    if (!claim.accepted) {
      const result = await repo.getGeneration({ ...input, now });
      return resolveGeneration(result, input.requestId);
    }
    guardConversation(claim.parent);
    const current = await repo.getGeneration({ ...input, now });
    if (!current) throw outcomeError('ASSISTANT_SEND_UNCERTAIN');
    guardConversation(current.parent);
    guardConversation(current.request);
    if (current.request.state !== 'pending' || current.parent.claim?.fence !== claim.request.fence
      || current.parent.claim?.requestId !== input.requestId) {
      return resolveGeneration(current, input.requestId, { ambiguous: true });
    }
    if (+new Date(current.request.claimExpiresAt) <= +now()) {
      await repo.recoverClaim({ ...input, now });
      return reconcile(input);
    }
    // No await between the fresh deadline check and the single AI1 invocation.
    guardConversation(claim.parent);
    let reply;
    let safeOutcome;
    try { reply = await chat(claim.request.replaySnapshot.map(({ role, content }) => ({ role, content }))); }
    catch (error) {
      safeOutcome = ['ASSISTANT_NOT_CONFIGURED', 'ASSISTANT_UNAVAILABLE', 'ASSISTANT_TIMEOUT'].includes(error?.code)
        ? error.code : 'ASSISTANT_UNAVAILABLE';
    }
    guardConversation(claim.parent);
    try {
      await repo.finishGeneration({ ...input, fence: claim.request.fence, version: claim.parent.version,
        expiresAt: claim.parent.expiresAt, reply, safeOutcome, now });
    } catch (error) {
      // Reconcile an unknown commit through live parent/result reads; no provider retry.
      guardConversation(claim.parent);
      if (error?.code === 'ASSISTANT_CONVERSATION_NOT_FOUND') throw notFound();
      return reconcile(input);
    }
    guardConversation(claim.parent);
    const result = await repo.getGeneration({ ...input, now });
    return resolveGeneration(result, input.requestId);
  }
  return { create, list, open, remove, send, guardConversation, guardList };
}

module.exports = { createHistoryService, buildReplay, ...createHistoryService() };
