const mongoose = require('mongoose');

const PRODUCTION_MAX_POOL_SIZE = 10;

function databaseConnectionOptions(nodeEnv) {
  if (nodeEnv !== 'production') {
    return {};
  }

  return {
    // One small Render instance does not need Mongoose's much larger default
    // pool. Keep the cap conservative without forcing idle connections open.
    maxPoolSize: PRODUCTION_MAX_POOL_SIZE,
  };
}

async function connectDatabase(uri, nodeEnv = 'development') {
  await mongoose.connect(uri, databaseConnectionOptions(nodeEnv));
  console.log(`[database] connected to MongoDB database "${mongoose.connection.name}"`);
  return mongoose.connection;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) {
    return;
  }
  await mongoose.disconnect();
  console.log('[database] disconnected from MongoDB');
}

module.exports = {
  PRODUCTION_MAX_POOL_SIZE,
  databaseConnectionOptions,
  connectDatabase,
  disconnectDatabase,
};
