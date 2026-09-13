const { loadEnv } = require('../config/env');
const { AppError } = require('../shared/errors/app-error');
const { sendError } = require('../shared/http/response');

// body-parser/raw-body errors are recognized by their known `type`, never by
// trusting an arbitrary err.status/statusCode — any thrown value can carry a
// `.status`, so keying off it would let unrelated errors slip into one of
// these responses. Status codes and messages here are fixed, not read off
// the underlying error, so parser internals never reach the client.
const BODY_PARSER_ERROR_RESPONSES = {
  'entity.parse.failed': {
    statusCode: 400,
    code: 'REQUEST_BODY_INVALID',
    message: 'Request body is invalid.',
  },
  'entity.too.large': {
    statusCode: 413,
    code: 'REQUEST_BODY_TOO_LARGE',
    message: 'Request body is too large.',
  },
};

// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  const { nodeEnv } = loadEnv();

  if (err instanceof AppError) {
    // Expected 4xx-style errors are noisy in every environment except
    // production, where they're expected traffic rather than a bug signal.
    if (nodeEnv !== 'production') {
      console.error(err);
    }
    return sendError(res, err.statusCode, err.code, err.message, err.details);
  }

  const bodyParserResponse = BODY_PARSER_ERROR_RESPONSES[err?.type];
  if (bodyParserResponse) {
    // body-parser attaches the raw, unparsed request payload as `err.body`
    // (see body-parser/lib/read.js) so its own error handlers can inspect
    // it — logging `err` directly would print that raw payload (which, for
    // a malformed /auth/login or /auth/register request, can be a
    // plaintext password) to the server console. Log only the identifying
    // fields, never the payload itself.
    if (nodeEnv !== 'production') {
      console.error('Body parser error', {
        type: err?.type,
        message: err?.message,
        stack: err?.stack,
      });
    }
    return sendError(
      res,
      bodyParserResponse.statusCode,
      bodyParserResponse.code,
      bodyParserResponse.message
    );
  }

  // Unexpected/internal errors are always logged server-side, including in
  // production, so operators can debug them — the client never sees them.
  console.error(err);
  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
}

module.exports = { errorMiddleware };
