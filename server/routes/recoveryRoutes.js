const express = require('express');
const router = express.Router();
const controller = require('../controllers/projectController');

// GET  /api/recovery/status
router.get('/status', controller.recoveryStatus);

// POST /api/recovery/force-clean
router.post('/force-clean', controller.forceClean);

module.exports = router;