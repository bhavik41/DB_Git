const { atomicCommit, atomicRollback, logFailure } = require('../services/transactionService');
const { getRecoveryStatus, forceCleanOperation } = require('../services/recoveryService');
const projectService = require('../services/projectService');

class ProjectController {

    async createProject(req, res) {
        const { name, description, targetDbUrl } = req.body;
        const username = req.user.username;
        try {
            const project = await projectService.createProject(name, description, username, targetDbUrl);
            res.status(201).json({ success: true, project });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async getProject(req, res) {
        const { name } = req.params;
        try {
            const project = await projectService.getProjectByName(name);
            if (!project) return res.status(404).json({ error: 'Project not found' });
            res.json(project);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // Member 6: atomic commit with lock + transaction
    async commit(req, res) {
        const { name } = req.params;
        const { message, snapshot, diff, prevCommitId, branchName } = req.body;
        const author = req.user.username;
        try {
            const commit = await atomicCommit(name, {
                message, snapshot, diff, prevCommitId,
                branchName: branchName || 'main', author
            });
            res.json({ success: true, commitId: commit.id });
        } catch (error) {
            await logFailure('commit', name, branchName, author, error, { prevCommitId });
            const status = error.message.includes('diverged') ? 409 : 500;
            res.status(status).json({ success: false, error: error.message });
        }
    }

    async getLatestCommit(req, res) {
        const { name } = req.params;
        const { branch } = req.query;
        try {
            const commit = await projectService.getLatestCommit(name, branch);
            res.json({ commit });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getCommitById(req, res) {
        const { name, commitId } = req.params;
        try {
            const commit = await projectService.getCommitById(name, commitId);
            if (!commit) return res.status(404).json({ error: 'Commit not found' });
            res.json(commit);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getLog(req, res) {
        const { name } = req.params;
        const { branch, cursor } = req.query;
        try {
            const commits = await projectService.getCommitLog(name, branch, 50, cursor || null);
            res.json({ commits });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // Member 6: atomic rollback with in-progress tracking
    async rollback(req, res) {
        const { name, commitId } = req.params;
        const author = req.user?.username || 'unknown';
        try {
            const commit = await atomicRollback(name, commitId, async (targetCommit) => {
                await projectService.rollbackProject(name, targetCommit.id);
            });
            res.json({ success: true, message: `Rolled back to [${commit.id.substring(0, 8)}]` });
        } catch (error) {
            await logFailure('rollback', name, 'main', author, error, { commitId });
            res.status(500).json({ error: error.message });
        }
    }

    async createBranch(req, res) {
        const { name } = req.params;
        const { branchName, startCommitId } = req.body;
        try {
            const branch = await projectService.createBranch(name, branchName, startCommitId);
            res.status(201).json({ success: true, branch });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async getBranches(req, res) {
        const { name } = req.params;
        try {
            const branches = await projectService.listBranches(name);
            res.json({ success: true, branches });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // M5 — Storage Analysis
    async getStorageStats(req, res) {
        const { name } = req.params;
        try {
            const stats = await projectService.getStorageStats(name);
            res.json({ success: true, stats });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // M5 — Index/Query Plan Analysis
    async getIndexAnalysis(req, res) {
        try {
            const analysis = await projectService.getIndexAnalysis();
            res.json({ success: true, analysis });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // M5 — PostgreSQL System Cache & Index Verification
    async getSystemAnalysis(req, res) {
        try {
            const systemStats = await projectService.getSystemAnalysis();
            res.json({ success: true, systemStats });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // M5 — Index Efficiency Ratio
    async getIndexEfficiency(req, res) {
        try {
            const efficiency = await projectService.getIndexEfficiencyRatio();
            res.json({ success: true, efficiency });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // Member 6 — Recovery endpoints
    async recoveryStatus(req, res) {
        try {
            const status = await getRecoveryStatus();
            res.json({ success: true, ...status });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async forceClean(req, res) {
        try {
            const { opId } = req.body;
            if (!opId) return res.status(400).json({ error: 'opId is required' });
            const op = await forceCleanOperation(opId);
            res.json({ success: true, cleaned: op });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = new ProjectController();