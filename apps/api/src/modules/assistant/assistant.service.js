const { loadEnv } = require('../../config/env');
const { AppError } = require('../../shared/errors/app-error');
const openAiProvider = require('./openai.provider');

function notConfiguredError() {
  return new AppError('The cooking assistant is not configured.', {
    statusCode: 503,
    code: 'ASSISTANT_NOT_CONFIGURED',
  });
}

function createAssistantService({
  getConfig = () => loadEnv().openai,
  requestReply = openAiProvider.requestAssistantReply,
  log = (entry) => console.info(entry),
  now = Date.now,
} = {}) {
  return async function chat(messages) {
    const startedAt = now();
    let failureCategory;
    try {
      const config = getConfig();
      if (!config.apiKey || !config.model) {
        failureCategory = 'not_configured';
        throw notConfiguredError();
      }
      const reply = await requestReply({
        apiKey: config.apiKey,
        model: config.model,
        messages,
      });
      log({ event: 'assistant.chat', outcome: 'success', latencyMs: Math.max(0, now() - startedAt) });
      return reply;
    } catch (error) {
      if (!failureCategory) {
        failureCategory = error?.code === 'ASSISTANT_TIMEOUT' ? 'timeout' : 'provider_unavailable';
      }
      log({
        event: 'assistant.chat',
        outcome: 'failure',
        latencyMs: Math.max(0, now() - startedAt),
        category: failureCategory,
      });
      if (
        error instanceof AppError &&
        ['ASSISTANT_NOT_CONFIGURED', 'ASSISTANT_TIMEOUT', 'ASSISTANT_UNAVAILABLE'].includes(error.code)
      ) {
        throw error;
      }
      throw new AppError('The cooking assistant is temporarily unavailable.', {
        statusCode: 503,
        code: 'ASSISTANT_UNAVAILABLE',
      });
    }
  };
}

const chat = createAssistantService();

module.exports = { createAssistantService, chat };
