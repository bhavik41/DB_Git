const express = require('express');
const { commitLock, rollbackLock, safeHandler } = require('../middleware/concurrency');
const router = express.Router();
const projectController = require('../controllers/projectController');

// M5: Performance Analysis Routes
router.get('/:name/analyze/storage', projectController.getStorageStats);
router.get('/:name/analyze/indexes', projectController.getIndexAnalysis);
router.get('/:name/analyze/system', projectController.getSystemAnalysis);
router.get('/:name/analyze/efficiency', projectController.getIndexEfficiency);

// Project Routes
router.post('/', projectController.createProject);
router.get('/:name', projectController.getProject);

// Commit Routes
router.post('/:name/commits', commitLock, safeHandler(projectController.commit));
router.get('/:name/commits/latest', projectController.getLatestCommit);
router.get('/:name/commits/:commitId', projectController.getCommitById);
router.post('/:name/rollback/:commitId', rollbackLock, safeHandler(projectController.rollback));

// Branch Routes
router.get('/:name/branches', projectController.getBranches);
router.post('/:name/branches', projectController.createBranch);

// History/Log Routes
router.get('/:name/log', projectController.getLog);

module.exports = router;