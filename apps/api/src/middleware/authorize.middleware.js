const { AppError } = require('../shared/errors/app-error');

/**
 * Builds middleware that requires req.auth.role to be one of the allowed
 * roles. Must run after authenticate — relies entirely on req.auth.
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth) {
      return next(
        new AppError('Authentication required.', { statusCode: 401, code: 'AUTH_TOKEN_MISSING' })
      );
    }

    if (!allowedRoles.includes(req.auth.role)) {
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

module.exports = { authorize };