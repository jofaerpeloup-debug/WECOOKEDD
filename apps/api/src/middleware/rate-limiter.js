const rateLimit = require('express-rate-limit');
const { AppError } = require('../shared/errors/app-error');

/**
 * Wraps express-rate-limit so a limited request is routed through the same
 * AppError -> central error middleware path as every other error, instead
 * of the library's default 429 response.
 */
function createRateLimiter(options) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...options,
    handler: (req, res, next) => {
      next(
        new AppError('Too many requests. Please try again later.', {
          statusCode: 429,
          code: 'RATE_LIMIT_EXCEEDED',
        })
      );
    },
  });
}

module.exports = { createRateLimiter };
