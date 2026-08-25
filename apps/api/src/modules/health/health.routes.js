const { Router } = require('express');
const { sendSuccess } = require('../../shared/http/response');

const router = Router();

router.get('/', (req, res) => {
  sendSuccess(res, {
    status: 'ok',
    service: 'wecooked-api',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
