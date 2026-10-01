export const ASSISTANT_LIMITS = Object.freeze({
  maxMessages: 12,
  maxTotalLength: 12000,
  maxUserLength: 2000,
  maxAssistantLength: 4000,
});

export function createAssistantState() {
  return {
    messages: [],
    input: '',
    status: 'idle',
    error: null,
    failedRequest: null,
  };
}

export function setAssistantInput(state, input) {
  return { ...state, input };
}

function normalizeMessage(message) {
  if (!message || (message.role !== 'user' && message.role !== 'assistant')) return null;
  if (typeof message.content !== 'string') return null;

  const maxLength =
    message.role === 'user'
      ? ASSISTANT_LIMITS.maxUserLength
      : ASSISTANT_LIMITS.maxAssistantLength;
  const content = message.content.trim().slice(0, maxLength);
  return content ? { role: message.role, content } : null;
}

export function buildAssistantTranscript(messages) {
  const normalized = messages.map(normalizeMessage).filter(Boolean);
  const suffix = [];
  let totalLength = 0;

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index];
    if (suffix.length >= ASSISTANT_LIMITS.maxMessages) break;
    if (totalLength + message.content.length > ASSISTANT_LIMITS.maxTotalLength) break;
    suffix.unshift(message);
    totalLength += message.content.length;
  }

  return suffix;
}

export function prepareAssistantSend(state, candidate) {
  if (state.status === 'sending' || typeof candidate !== 'string') {
    return { accepted: false, state, transcript: null };
  }

  const content = candidate.trim().slice(0, ASSISTANT_LIMITS.maxUserLength);
  if (!content) return { accepted: false, state, transcript: null };

  const messages = [...state.messages, { role: 'user', content }];
  const transcript = buildAssistantTranscript(messages);
  return {
    accepted: true,
    transcript,
    state: {
      ...state,
      messages,
      input: '',
      status: 'sending',
      error: null,
      failedRequest: null,
    },
  };
}

export function completeAssistantRequest(state, reply) {
  return {
    ...state,
    messages: [...state.messages, { role: 'assistant', content: reply }],
    status: 'idle',
    error: null,
    failedRequest: null,
  };
}

export function failAssistantRequest(state, transcript, error) {
  return {
    ...state,
    status: 'idle',
    error,
    failedRequest: transcript.map((message) => ({ ...message })),
  };
}

export function prepareAssistantRetry(state) {
  if (state.status === 'sending' || !state.failedRequest) {
    return { accepted: false, state, transcript: null };
  }

  return {
    accepted: true,
    transcript: state.failedRequest.map((message) => ({ ...message })),
    state: { ...state, status: 'sending', error: null },
  };
}

export function createAssistantRequestIdentity(generation, requestId) {
  return { generation, requestId };
}

export function isAssistantRequestCurrent(
  { mounted, generation, activeRequest },
  candidateRequest
) {
  return Boolean(
    mounted &&
      activeRequest === candidateRequest &&
      generation === candidateRequest?.generation
  );
}
