const CAPABILITIES = Object.freeze({
  CONSUMER: 'consumer',
  CATALOG_READ_ALL: 'catalog.read_all',
  CATALOG_WRITE: 'catalog.write',
  RECIPE_IMAGE_UPLOAD: 'recipe_image.upload',
  USERS_MANAGE: 'users.manage',
  STAFF_MANAGE: 'staff.manage',
  MONITORING_READ: 'monitoring.read',
});

// This map is the authority source for staff capabilities. Routes must gate
// privileged operations through requireCapability rather than role literals.
const ROLE_CAPABILITIES = Object.freeze({
  user: Object.freeze([CAPABILITIES.CONSUMER]),
  moderator: Object.freeze([
    CAPABILITIES.CONSUMER,
    CAPABILITIES.CATALOG_READ_ALL,
    CAPABILITIES.CATALOG_WRITE,
    CAPABILITIES.RECIPE_IMAGE_UPLOAD,
  ]),
  admin: Object.freeze([
    CAPABILITIES.CONSUMER,
    CAPABILITIES.CATALOG_READ_ALL,
    CAPABILITIES.USERS_MANAGE,
    CAPABILITIES.STAFF_MANAGE,
    CAPABILITIES.MONITORING_READ,
  ]),
});

function hasCapability(role, capability) {
  const capabilities = ROLE_CAPABILITIES[role];
  return Array.isArray(capabilities) && capabilities.includes(capability);
}

module.exports = { CAPABILITIES, ROLE_CAPABILITIES, hasCapability };
