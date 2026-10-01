const {
  ASSISTANT_LIMITS,
  buildAssistantTranscript,
  completeAssistantRequest,
  createAssistantRequestIdentity,
  createAssistantState,
  failAssistantRequest,
  isAssistantRequestCurrent,
  prepareAssistantRetry,
  prepareAssistantSend,
} = require('../src/screens/assistantState');

it('blocks blank input without changing state', () => {
  const state = createAssistantState();
  const result = prepareAssistantSend(state, '   ');
  expect(result).toEqual({ accepted: false, state, transcript: null });
});

it('trims accepted input, clears the composer, and appends one user message', () => {
  const initial = { ...createAssistantState(), input: '  lentils  ' };
  const result = prepareAssistantSend(initial, initial.input);
  expect(result.accepted).toBe(true);
  expect(result.state.input).toBe('');
  expect(result.state.status).toBe('sending');
  expect(result.state.messages).toEqual([{ role: 'user', content: 'lentils' }]);
  expect(result.transcript).toEqual(result.state.messages);
});

it('enforces single flight in state and appends one Assistant reply on success', () => {
  const first = prepareAssistantSend(createAssistantState(), 'Question');
  const duplicate = prepareAssistantSend(first.state, 'Question');
  expect(duplicate.accepted).toBe(false);
  const complete = completeAssistantRequest(first.state, 'Answer');
  expect(complete.messages).toEqual([
    { role: 'user', content: 'Question' },
    { role: 'assistant', content: 'Answer' },
  ]);
});

it('builds the newest strict transcript suffix within count and per-message limits', () => {
  const messages = Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: ` message-${index} `,
    ignored: true,
  }));
  const transcript = buildAssistantTranscript(messages);
  expect(transcript).toHaveLength(ASSISTANT_LIMITS.maxMessages);
  expect(transcript[0]).toEqual({ role: 'user', content: 'message-2' });
  expect(transcript.at(-1)).toEqual({ role: 'assistant', content: 'message-13' });
  expect(transcript.every((message) => Object.keys(message).sort().join(',') === 'content,role')).toBe(true);

  const overlong = buildAssistantTranscript([
    { role: 'user', content: 'u'.repeat(2500) },
    { role: 'assistant', content: 'a'.repeat(4500) },
  ]);
  expect(overlong[0].content).toHaveLength(ASSISTANT_LIMITS.maxUserLength);
  expect(overlong[1].content).toHaveLength(ASSISTANT_LIMITS.maxAssistantLength);
});

it('stops at the total bound while retaining the current user message', () => {
  const messages = [
    { role: 'assistant', content: 'a'.repeat(4000) },
    { role: 'user', content: 'b'.repeat(2000) },
    { role: 'assistant', content: 'c'.repeat(4000) },
    { role: 'user', content: 'd'.repeat(2000) },
    { role: 'user', content: 'current' },
  ];
  const transcript = buildAssistantTranscript(messages);
  expect(transcript.at(-1)).toEqual({ role: 'user', content: 'current' });
  expect(transcript.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(
    ASSISTANT_LIMITS.maxTotalLength
  );
  expect(transcript[0].content[0]).toBe('b');
});

it('retries the saved logical request without duplicating its user message', () => {
  const sent = prepareAssistantSend(createAssistantState(), 'Use chickpeas');
  const failed = failAssistantRequest(sent.state, sent.transcript, 'Try again.');
  const retry = prepareAssistantRetry(failed);
  expect(retry.accepted).toBe(true);
  expect(retry.transcript).toEqual(sent.transcript);
  expect(retry.state.messages).toEqual([{ role: 'user', content: 'Use chickpeas' }]);
  expect(retry.state.messages.filter((message) => message.role === 'user')).toHaveLength(1);
});

it('reset state clears transient conversation and retry data', () => {
  const sent = prepareAssistantSend(createAssistantState(), 'Question');
  const failed = failAssistantRequest(sent.state, sent.transcript, 'Failure');
  expect(failed.failedRequest).toEqual(sent.transcript);
  expect(createAssistantState()).toEqual({
    messages: [],
    input: '',
    status: 'idle',
    error: null,
    failedRequest: null,
  });
});

it('accepts completion only for the mounted active request in the same generation', () => {
  const oldRequest = createAssistantRequestIdentity(2, 7);
  const newRequest = createAssistantRequestIdentity(3, 8);

  expect(
    isAssistantRequestCurrent(
      { mounted: true, generation: 2, activeRequest: oldRequest },
      oldRequest
    )
  ).toBe(true);
  expect(
    isAssistantRequestCurrent(
      { mounted: false, generation: 2, activeRequest: oldRequest },
      oldRequest
    )
  ).toBe(false);
  expect(
    isAssistantRequestCurrent(
      { mounted: true, generation: 3, activeRequest: newRequest },
      oldRequest
    )
  ).toBe(false);
  expect(
    isAssistantRequestCurrent(
      { mounted: true, generation: 3, activeRequest: newRequest },
      newRequest
    )
  ).toBe(true);
});
