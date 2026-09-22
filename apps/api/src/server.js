const { loadEnv } = require('./config/env');
const { createApp } = require('./app');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { verifyRequiredIndexes } = require('./config/required-indexes');

async function start() {
  const env = loadEnv();

  await connectDatabase(env.mongodbUri, env.nodeEnv);

  // Read-only. Refuses to serve traffic when the unique auth-identity index is
  // missing or has drifted. This check never creates or repairs THAT index —
  // the auth-identity migration is its only creator. It says nothing about the
  // other schema-declared indexes Mongoose still manages on its own.
  await verifyRequiredIndexes();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] listening on port ${env.port} (${env.nodeEnv})`);
  });

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[server] received ${signal}, shutting down...`);

    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('[server] failed to start:', error.message);
  process.exit(1);
});
