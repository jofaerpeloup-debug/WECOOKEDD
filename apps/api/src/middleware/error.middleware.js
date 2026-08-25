const { loadEnv } = require('../config/env');
const { AppError } = require('../shared/errors/app-error');
const { sendError } = require('../shared/http/response');

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

  // Unexpected/internal errors are always logged server-side, including in
  // production, so operators can debug them — the client never sees them.
  console.error(err);
  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
}

module.exports = { errorMiddleware };
