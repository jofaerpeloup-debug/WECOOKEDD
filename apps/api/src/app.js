const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const { loadEnv } = require('./config/env');
const { AppError } = require('./shared/errors/app-error');
const v1Routes = require('./routes/v1.routes');
const { createRateLimiter } = require('./middleware/rate-limiter');
const { notFoundMiddleware } = require('./middleware/not-found.middleware');
const { errorMiddleware } = require('./middleware/error.middleware');

/**
 * Builds and configures the Express application. Does not call
 * app.listen() and does not connect to MongoDB — safe to import and
 * invoke in tests without a running server or a live database.
 */
function createApp() {
  const env = loadEnv();
  const app = express();

  // Security headers first.
  app.use(helmet());

  // Allowlist-based CORS. Requests with no Origin header (native apps,
  // server-to-server calls, curl, tests) are always allowed through;
  // browser requests from unlisted origins are rejected.
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(
          new AppError('Origin not allowed by CORS policy.', {
            statusCode: 403,
            code: 'CORS_NOT_ALLOWED',
          })
        );
      },
      credentials: true,
    })
  );

  if (env.nodeEnv === 'development') {
    app.use(morgan('dev'));
  }

  // Baseline rate limit, applied before body parsing to shed excess load early.
  app.use(
    createRateLimiter({
      windowMs: 15 * 60 * 1000,
      limit: 300,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use('/api/v1', v1Routes);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp };
