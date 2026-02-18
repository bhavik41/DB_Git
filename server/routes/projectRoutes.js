const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');

// Project Routes
router.post('/', projectController.createProject);
router.get('/:name', projectController.getProject);

// Commit Routes
router.post('/:name/commits', projectController.commit);
router.get('/:name/commits/latest', projectController.getLatestCommit);
router.get('/:name/commits/:commitId', projectController.getCommitById);

// History/Log Routes
router.get('/:name/log', projectController.getLog);

module.exports = router;
