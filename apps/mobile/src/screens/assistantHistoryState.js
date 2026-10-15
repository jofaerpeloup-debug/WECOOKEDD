import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as history from '../api/assistantHistoryService';
import { getAssistantError } from '../api/assistantErrors';
import { ASSISTANT_LIMITS } from './assistantState';

export const emptyPage = () => ({ hasMore: false, nextCursor: null });
export const createHistoryState = () => ({
  conversation: null, messages: [], input: '', status: 'idle', error: null,
  failedRequest: null, reviewRequired: false, pageInfo: emptyPage(),
  historyVisible: false, conversations: [], listPage: emptyPage(),
  listStatus: 'idle', listError: null, deleteStatus: 'idle', deleteError: null,
});
export const isLiveConversation = (value, now = Date.now()) => Boolean(value && Date.parse(value.expiresAt) > now);
export function mergeMessages(older, newer) {
  return [...new Map([...older, ...newer].map((row) => [row.id, row])).values()]
    .sort((a, b) => a.sequence - b.sequence);
}
export function mergeConversations(older, newer) {
  return [...new Map([...older, ...newer].map((row) => [row.id, row])).values()]
    .filter((row) => isLiveConversation(row))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
}
export function retryableUser(messages) {
  const latest = messages.filter((row) => row.role === 'user').at(-1);
  return latest?.status === 'failed' && messages.at(-1)?.id === latest.id ? latest : null;
}
export function historySessionKey({ status, user, sessionIdentity }) {
  return JSON.stringify([status, user?.id || '', sessionIdentity?.ownerId,
    sessionIdentity?.generation, sessionIdentity?.localSessionRevision]);
}
const missing = (error) => error?.code === 'ASSISTANT_CONVERSATION_NOT_FOUND';
const safeError = (error) => getAssistantError(error).message;
const REVIEW = 'Review the saved conversation before sending again.';

export function useAssistantHistory(auth) {
  const session = historySessionKey(auth);
  const owner = auth.status === 'authenticated' ? auth.user?.id : null;
  const [state, setState] = useState(createHistoryState);
  const stateRef = useRef(state);
  const scope = useRef({ session, epoch: 0, list: 0, mounted: true, busy: null,
    createKey: null, createPromise: null, selectedId: null, deleteRequest: null, deletedIds: new Set() });
  const previousSession = useRef(session);
  // Update the guard during render, before an old promise can settle.
  if (scope.current.session !== session) {
    scope.current = { session, epoch: scope.current.epoch + 1, list: scope.current.list + 1,
      mounted: true, busy: null, createKey: null, createPromise: null,
      selectedId: null, deleteRequest: null, deletedIds: new Set() };
  }
  const commit = useCallback((patch) => {
    const next = typeof patch === 'function' ? patch(stateRef.current) : { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);
  const capture = () => ({ session, epoch: scope.current.epoch });
  const current = (token) => scope.current.mounted && scope.current.session === token.session
    && scope.current.epoch === token.epoch;
  const reset = useCallback(() => {
    scope.current.epoch += 1;
    scope.current.list += 1;
    scope.current.busy = null;
    scope.current.createKey = null;
    scope.current.createPromise = null;
    scope.current.selectedId = null;
    commit((old) => ({ ...createHistoryState(), historyVisible: old.historyVisible,
      conversations: old.conversations, listPage: old.listPage, listStatus: 'idle',
      listError: old.listError, deleteStatus: scope.current.deleteRequest ? 'loading' : 'idle' }));
  }, [commit]);

  async function loadList(cursor) {
    if (!owner || scope.current.session !== session) return;
    const token = { session, list: ++scope.current.list };
    const valid = () => scope.current.mounted && scope.current.session === token.session
      && scope.current.list === token.list;
    commit({ listStatus: 'loading', listError: null });
    try {
      const data = await history.listConversations(cursor);
      if (!valid()) return;
      commit((old) => ({ ...old, listStatus: 'idle', listPage: data.pageInfo,
        conversations: mergeConversations(cursor ? old.conversations : [], data.conversations)
          .filter((row) => !scope.current.deletedIds.has(row.id)) }));
    } catch (error) {
      if (valid()) commit({ listStatus: 'idle', listError: safeError(error) });
    }
  }
  function unavailable() {
    reset();
    commit({ error: 'This conversation is no longer available. Start a new chat to continue.' });
    loadList();
  }
  function clearDeletedConversation() {
    reset();
    commit({ reviewRequired: true, error: 'This conversation was deleted. Start a new chat to continue.' });
  }
  function acceptConversation(value) {
    if (scope.current.deletedIds.has(value?.id)) {
      clearDeletedConversation();
      loadList();
      return false;
    }
    if (isLiveConversation(value)) return true;
    unavailable();
    return false;
  }
  async function ensureConversation(token) {
    if (stateRef.current.conversation) return stateRef.current.conversation;
    scope.current.createKey ||= history.newHistoryRequestId();
    scope.current.createPromise ||= history.createConversation(scope.current.createKey);
    const promise = scope.current.createPromise;
    try {
      const value = await promise;
      if (!current(token) || !acceptConversation(value)) return null;
      scope.current.selectedId = value.id;
      commit({ conversation: value });
      return value;
    } finally {
      if (current(token) && scope.current.createPromise === promise) scope.current.createPromise = null;
    }
  }
  async function newChat() {
    if (!owner || scope.current.session !== session || scope.current.busy === 'create') return;
    // New may leave a saved send running. It only invalidates its UI identity.
    if (!(stateRef.current.failedRequest?.kind === 'create')) reset();
    const token = capture();
    scope.current.busy = 'create';
    commit({ status: 'creating', error: null, failedRequest: null });
    try {
      const value = await ensureConversation(token);
      if (!current(token) || !value) return;
      scope.current.busy = null;
      commit({ status: 'idle' });
      loadList();
    } catch (error) {
      if (!current(token)) return;
      scope.current.busy = null;
      if (missing(error)) { unavailable(); return; }
      commit({ status: 'idle', error: safeError(error), failedRequest: { kind: 'create' } });
    }
  }
  async function open(id, cursor) {
    if (!owner || scope.current.session !== session || scope.current.deletedIds.has(id)) return;
    if (cursor && (scope.current.busy || stateRef.current.conversation?.id !== id)) return;
    if (!cursor) reset();
    scope.current.selectedId = id;
    const token = capture();
    scope.current.busy = 'open';
    commit({ status: 'opening', error: null, failedRequest: null, historyVisible: false });
    try {
      const data = await history.openConversation(id, cursor);
      if (!current(token) || !acceptConversation(data.conversation)) return;
      scope.current.busy = null;
      commit((old) => ({ ...old, conversation: data.conversation,
        messages: mergeMessages(cursor ? data.messages : [], cursor ? old.messages : data.messages),
        pageInfo: data.pageInfo, status: 'idle',
        reviewRequired: data.messages.some((row) => row.status === 'pending'),
        failedRequest: data.messages.some((row) => row.status === 'pending') ? { kind: 'open', id } : null,
        error: data.messages.some((row) => row.status === 'pending') ? 'A message is still processing. Refresh the saved conversation to review its outcome.'
          : data.messages.some((row) => row.status === 'uncertain')
          ? 'A previous send has an uncertain outcome. Review this history before explicitly sending again.' : null }));
    } catch (error) {
      if (!current(token)) return;
      scope.current.busy = null;
      if (missing(error)) { unavailable(); return; }
      commit({ status: 'idle', error: safeError(error), reviewRequired: true,
        failedRequest: { kind: 'open', id, cursor } });
    }
  }
  async function runSend(attempt, token) {
    try {
      const value = await ensureConversation(token);
      if (!current(token) || !value) return;
      if (!attempt.body) attempt.body = { requestId: history.newHistoryRequestId(),
        expectedVersion: value.version,
        ...(attempt.retryOf ? { retryOf: attempt.retryOf } : { content: attempt.content }) };
      attempt.id = value.id;
      const result = await history.sendConversationMessage(attempt.id, attempt.body);
      if (!current(token) || !acceptConversation(result.conversation)) return;
      scope.current.busy = null;
      commit((old) => ({ ...old, conversation: result.conversation,
        messages: mergeMessages(old.messages.filter((row) => row.id !== attempt.optimisticId),
          [result.userMessage, result.assistantMessage]),
        status: 'idle', error: null, failedRequest: null, reviewRequired: false }));
      loadList();
    } catch (error) {
      if (!current(token)) return;
      scope.current.busy = null;
      if (missing(error)) { unavailable(); return; }
      const transport = !attempt.id || error?.isNetworkError || error?.code === 'ASSISTANT_MALFORMED_RESPONSE'
        || !(error?.status > 0);
      if (transport) {
        // Replay only on a user tap, with the same create/send identity and body.
        commit({ status: 'idle', error: safeError(error), failedRequest: { kind: 'transport', attempt },
          reviewRequired: true });
      } else {
        // No blind generation retry, including timeouts and conflicts. Open obtains
        // authoritative version and failed/uncertain status before another send.
        commit({ status: 'idle', error: error?.code === 'VALIDATION_ERROR' ? safeError(error) : REVIEW,
          failedRequest: attempt.id ? { kind: 'open', id: attempt.id } : null, reviewRequired: true });
        loadList();
      }
    }
  }
  function send(candidate = stateRef.current.input, retryOf) {
    if (!owner || scope.current.session !== session || scope.current.busy || stateRef.current.reviewRequired) return;
    const content = typeof candidate === 'string' ? candidate.trim().slice(0, ASSISTANT_LIMITS.maxUserLength) : '';
    if (!retryOf && !content) return;
    const parent = stateRef.current.conversation;
    if (parent && !acceptConversation(parent)) return;
    const attempt = { content, retryOf, optimisticId: `draft-${history.newHistoryRequestId()}` };
    scope.current.busy = 'send';
    commit((old) => ({ ...old, status: 'sending', input: '', error: null, failedRequest: null,
      messages: retryOf ? old.messages : [...old.messages,
        { id: attempt.optimisticId, role: 'user', content, status: 'pending', sequence: Number.MAX_SAFE_INTEGER }] }));
    runSend(attempt, capture());
  }
  function retry() {
    if (!owner || scope.current.session !== session || scope.current.busy) return;
    const failed = stateRef.current.failedRequest;
    if (failed?.kind === 'create') { newChat(); return; }
    if (failed?.kind === 'open') { open(failed.id, failed.cursor); return; }
    if (failed?.kind === 'transport') {
      if (stateRef.current.conversation && !acceptConversation(stateRef.current.conversation)) return;
      scope.current.busy = 'send';
      commit({ status: 'sending', error: null, failedRequest: null });
      runSend(failed.attempt, capture());
      return;
    }
    const userMessage = retryableUser(stateRef.current.messages);
    if (userMessage) send('', userMessage.id);
  }
  async function remove(id) {
    if (!owner || scope.current.session !== session || scope.current.deleteRequest) return;
    // Delete belongs to its session and operation, independently of selection.
    // Reopening the target must not invalidate a confirmed deletion.
    const token = { session, id };
    scope.current.deleteRequest = token;
    const valid = () => scope.current.mounted && scope.current.session === token.session
      && scope.current.deleteRequest === token;
    const deleted = () => {
      scope.current.deleteRequest = null;
      scope.current.deletedIds.add(id);
      // selectedId also covers an Open that has not returned a transcript yet.
      if (scope.current.selectedId === id || stateRef.current.conversation?.id === id) clearDeletedConversation();
      commit((old) => ({ ...old, conversations: old.conversations.filter((row) => row.id !== id),
        deleteStatus: 'idle', deleteError: null }));
      loadList();
    };
    commit({ deleteStatus: 'loading', deleteError: null });
    try {
      await history.deleteConversation(id);
      if (!valid()) return;
      deleted();
    } catch (error) {
      if (!valid()) return;
      if (missing(error)) { deleted(); return; }
      scope.current.deleteRequest = null;
      commit({ deleteStatus: 'idle', deleteError: safeError(error) });
    }
  }

  useEffect(() => {
    scope.current.mounted = true;
    return () => { scope.current.mounted = false; scope.current.epoch += 1; scope.current.list += 1; };
  }, []);
  useEffect(() => {
    if (previousSession.current === session) return;
    previousSession.current = session;
    commit(createHistoryState());
  }, [session, commit]);
  useEffect(() => {
    const deadlines = [state.conversation, ...state.conversations].filter(Boolean)
      .map((row) => Date.parse(row.expiresAt));
    if (!deadlines.length) return undefined;
    const timer = setTimeout(() => {
      if (stateRef.current.conversation && !isLiveConversation(stateRef.current.conversation)) unavailable();
      commit((old) => ({ ...old, conversations: old.conversations.filter((row) => isLiveConversation(row)) }));
    }, Math.min(2147483647, Math.max(0, Math.min(...deadlines) - Date.now())));
    return () => clearTimeout(timer);
  }, [state.conversation, state.conversations]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || scope.current.session !== session) return;
      const parent = stateRef.current.conversation;
      if (parent && !isLiveConversation(parent)) unavailable();
      else if (parent) open(parent.id);
      loadList();
    });
    return () => subscription.remove();
  }, [session, owner]);

  const visible = scope.current.session === session && previousSession.current === session
    ? state : createHistoryState();
  return { state: visible, send, retry, reset, newChat, open, remove, loadList,
    updateInput: (input) => {
      if (owner && scope.current.session === session) commit({ input });
    },
    toggleHistory: () => {
      const show = !stateRef.current.historyVisible;
      commit({ historyVisible: show });
      if (show) loadList();
    },
  };
}
