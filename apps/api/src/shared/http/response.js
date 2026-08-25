function sendSuccess(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

function sendError(res, statusCode, code, message, details) {
  const error = { code, message };
  if (details) {
    error.details = details;
  }
  return res.status(statusCode).json({ success: false, error });
}

module.exports = { sendSuccess, sendError };
