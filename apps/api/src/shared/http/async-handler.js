/**
 * Wraps an async Express handler so a rejected promise is forwarded to
 * next(err) instead of becoming an unhandled rejection, without needing a
 * try/catch block in every controller.
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
