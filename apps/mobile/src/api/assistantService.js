import { api } from './client';

export const MALFORMED_ASSISTANT_RESPONSE = 'ASSISTANT_MALFORMED_RESPONSE';

export class AssistantServiceError extends Error {
  constructor() {
    super('Chef Assistant returned an invalid response.');
    this.name = 'AssistantServiceError';
    this.code = MALFORMED_ASSISTANT_RESPONSE;
  }
}

export async function sendAssistantMessage(messages) {
  const data = await api.post('/assistant/chat', {
    body: { messages },
  });
  const reply = typeof data?.reply === 'string' ? data.reply.trim() : '';

  if (!reply) {
    throw new AssistantServiceError();
  }

  return reply;
}
