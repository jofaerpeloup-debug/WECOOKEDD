const PushInstallation = require('./push-installation.model');

function findByInstallationIdWithSecrets(installationId) {
  return PushInstallation.findOne({ installationId }).select('+bindingCredentialHash +expoPushToken');
}

function createInstallation(values) {
  return PushInstallation.create(values);
}

function updateAuthorized({ installationId, credentialHash, expectedGeneration, values }) {
  return PushInstallation.findOneAndUpdate(
    { installationId, bindingCredentialHash: credentialHash, bindingGeneration: expectedGeneration },
    { $set: values },
    { returnDocument: 'after', runValidators: true }
  );
}

function unregisterAuthorized({ installationId, recipientId, sessionId, credentialHash, expectedGeneration, generation, now }) {
  return PushInstallation.findOneAndUpdate(
    {
      installationId,
      recipientId,
      sessionId,
      bindingCredentialHash: credentialHash,
      bindingGeneration: expectedGeneration,
      status: 'active',
    },
    { $set: { bindingGeneration: generation, status: 'unregistered', expoPushToken: null, unregisteredAt: now } },
    { returnDocument: 'after', runValidators: true }
  );
}

function findActiveForRecipient(recipientId, limit) {
  return PushInstallation.find({ recipientId, status: 'active', provider: 'expo' })
    .select('+expoPushToken')
    .limit(limit);
}

function unregisterExactToken(expoPushToken, now) {
  return PushInstallation.updateMany(
    { provider: 'expo', status: 'active', expoPushToken },
    { $set: { status: 'unregistered', expoPushToken: null, unregisteredAt: now } }
  );
}

module.exports = {
  findByInstallationIdWithSecrets,
  createInstallation,
  updateAuthorized,
  unregisterAuthorized,
  findActiveForRecipient,
  unregisterExactToken,
};
