const { requireCapability } = require('./require-capability.middleware');
const { CAPABILITIES } = require('../shared/security/capabilities');

const requireCatalogReadAll = requireCapability(CAPABILITIES.CATALOG_READ_ALL);

/**
 * Catalog list routes also serve the consumer-facing active view. Validation
 * runs first so the defaulted status is available here; only the explicit
 * inactive/all staff views cross the catalog.read_all capability gate.
 */
function requireCatalogReadAllForNonActive(req, res, next) {
  if (req.validated?.query?.status === 'active') return next();
  return requireCatalogReadAll(req, res, next);
}

module.exports = { requireCatalogReadAllForNonActive };
