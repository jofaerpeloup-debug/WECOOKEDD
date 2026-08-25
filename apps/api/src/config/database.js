const mongoose = require('mongoose');

async function connectDatabase(uri) {
  await mongoose.connect(uri);
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

module.exports = { connectDatabase, disconnectDatabase };
