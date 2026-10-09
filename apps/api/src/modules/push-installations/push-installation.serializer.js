function toPublicInstallation(row) {
  return {
    installationId: row.installationId,
    provider: row.provider,
    platform: row.platform,
    bindingGeneration: row.bindingGeneration,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

module.exports = { toPublicInstallation };
