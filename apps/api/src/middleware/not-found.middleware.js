const { sendError } = require('../shared/http/response');

function notFoundMiddleware(req, res) {
  sendError(res, 404, 'ROUTE_NOT_FOUND', 'Route not found.');
}

module.exports = { notFoundMiddleware };
