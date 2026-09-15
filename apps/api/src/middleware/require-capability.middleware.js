const { AppError } = require('../shared/errors/app-error');
const { hasCapability } = require('../shared/security/capabilities');

/**
 * Builds middleware for the target capability model. Must run after
 * authenticate, which supplies req.auth.role from current MongoDB User state.
 */
function requireCapability(capability) {
  return (req, res, next) => {
    if (!req.auth) {
      return next(
        new AppError('Authentication required.', { statusCode: 401, code: 'AUTH_TOKEN_MISSING' })
      );
    }

    if (!hasCapability(req.auth.role, capability)) {
      return next(
        new AppError('You do not have permission to perform this action.', {
          statusCode: 403,
          code: 'FORBIDDEN',
        })
      );
    }

    next();
  };
}

module.exports = { requireCapability };
