import { api } from './client';
import { randomUUID } from 'expo-crypto';

const ROOT = '/assistant/conversations';
export const newHistoryRequestId = () => randomUUID();

function malformed() {
  const error = new Error('Chef Assistant returned an invalid response.');
  error.code = 'ASSISTANT_MALFORMED_RESPONSE';
  throw error;
}
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
function conversation(value) {
  if (!id(value?.id) || !date(value.createdAt) || !date(value.updatedAt)
    || !date(value.expiresAt) || !Number.isSafeInteger(value.version) || value.version < 0) malformed();
  return { id: value.id, createdAt: value.createdAt, updatedAt: value.updatedAt,
    expiresAt: value.expiresAt, version: value.version };
}
function message(value) {
  if (!id(value?.id) || !['user', 'assistant'].includes(value.role)
    || typeof value.content !== 'string' || !value.content.trim() || !date(value.createdAt)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || (value.role === 'user' && !['pending', 'complete', 'failed', 'uncertain'].includes(value.status))) malformed();
  return { id: value.id, role: value.role, content: value.content, sequence: value.sequence,
    createdAt: value.createdAt, ...(value.role === 'user' ? { status: value.status } : {}) };
}
function page(value) {
  if (typeof value?.hasMore !== 'boolean' || (value.hasMore
    ? typeof value.nextCursor !== 'string' || !value.nextCursor || value.nextCursor.length > 1000
    : value.nextCursor !== null)) malformed();
  return { hasMore: value.hasMore, nextCursor: value.nextCursor };
}
export async function createConversation(requestId) {
  const data = await api.post(ROOT, { body: { requestId } });
  return conversation(data?.conversation);
}
export async function listConversations(cursor) {
  const data = await api.get(ROOT, { query: { limit: 20, ...(cursor ? { cursor } : {}) } });
  if (!Array.isArray(data?.conversations)) malformed();
  return { conversations: data.conversations.map(conversation), pageInfo: page(data.pageInfo) };
}
export async function openConversation(conversationId, cursor) {
  const data = await api.get(`${ROOT}/${conversationId}`, { query: { limit: 20, ...(cursor ? { cursor } : {}) } });
  if (!Array.isArray(data?.messages)) malformed();
  const parent = conversation(data.conversation);
  if (parent.id !== conversationId) malformed();
  return { conversation: parent, messages: data.messages.map(message), pageInfo: page(data.pageInfo) };
}
export async function deleteConversation(conversationId) {
  const data = await api.del(`${ROOT}/${conversationId}`);
  if (data?.deleted !== true) malformed();
  return { deleted: true };
}
export async function sendConversationMessage(conversationId, body) {
  // Copy only the frozen wire fields; never send a visible transcript.
  const payload = { requestId: body.requestId, expectedVersion: body.expectedVersion,
    ...(body.retryOf ? { retryOf: body.retryOf } : { content: body.content }) };
  const data = await api.post(`${ROOT}/${conversationId}/messages`, { body: payload });
  const parent = conversation(data?.conversation);
  const userMessage = message(data?.userMessage);
  const assistantMessage = message(data?.assistantMessage);
  if (parent.id !== conversationId || data.requestId !== body.requestId
    || userMessage.role !== 'user' || userMessage.status !== 'complete'
    || assistantMessage.role !== 'assistant' || assistantMessage.sequence !== userMessage.sequence + 1) malformed();
  return { conversation: parent, requestId: data.requestId, userMessage, assistantMessage };
}
