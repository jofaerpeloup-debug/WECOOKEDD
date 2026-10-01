const { AppError } = require('../../shared/errors/app-error');

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const PROVIDER_TIMEOUT_MS = 20_000;
const SERVER_INSTRUCTIONS =
  "You are WeCooked's cooking assistant. Help with cooking questions, recipe ideas, ingredient substitutions, recipe scaling, and meal ideas. You do not have access to the user's pantry, profile, saved recipes, or the WeCooked catalog unless that context is explicitly supplied by the WeCooked server in this request. Never claim that you accessed information that was not supplied. Do not claim that food, ingredients, substitutions, or recipes are allergy-safe, and do not give allergy-safety guarantees. Do not provide medical guarantees. Do not claim exact nutritional values or guarantees unless authoritative nutritional data is explicitly supplied by the WeCooked server. Do not claim that you saved, changed, added, removed, ordered, or otherwise performed any action in WeCooked. Be clear when uncertain, and keep the answer concise and practical.";

function unavailableError() {
  return new AppError('The cooking assistant is temporarily unavailable.', {
    statusCode: 503,
    code: 'ASSISTANT_UNAVAILABLE',
  });
}

function timeoutError() {
  return new AppError('The cooking assistant request timed out.', {
    statusCode: 504,
    code: 'ASSISTANT_TIMEOUT',
  });
}

function extractReply(payload) {
  if (!payload || !Array.isArray(payload.output)) return '';
  const text = [];
  for (const item of payload.output) {
    if (item?.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        text.push(content.text);
      }
    }
  }
  return text.join('').trim();
}

function createOpenAiProvider({
  fetchImpl = globalThis.fetch,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  return async function requestAssistantReply({ apiKey, model, messages }) {
    const controller = new AbortController();
    let deadlineReached = false;
    const timer = setTimeoutImpl(() => {
      deadlineReached = true;
      controller.abort();
    }, PROVIDER_TIMEOUT_MS);

    try {
      const response = await fetchImpl(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          instructions: SERVER_INSTRUCTIONS,
          input: messages.map(({ role, content }) => ({ role, content })),
          max_output_tokens: 600,
          store: false,
          tools: [],
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw unavailableError();

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw unavailableError();
      }
      const reply = extractReply(payload);
      if (!reply) throw unavailableError();
      return reply;
    } catch (error) {
      if (deadlineReached) throw timeoutError();
      if (error instanceof AppError && error.code === 'ASSISTANT_UNAVAILABLE') throw error;
      throw unavailableError();
    } finally {
      clearTimeoutImpl(timer);
    }
  };
}

const requestAssistantReply = createOpenAiProvider();

module.exports = {
  OPENAI_RESPONSES_URL,
  PROVIDER_TIMEOUT_MS,
  SERVER_INSTRUCTIONS,
  extractReply,
  createOpenAiProvider,
  requestAssistantReply,
};
