const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');

// Project Routes
router.post('/', projectController.createProject);


module.exports = router;
