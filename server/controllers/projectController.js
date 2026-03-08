const projectService = require('../services/projectService');

class ProjectController {

    async createProject(req, res) {
        const { name, description, targetDbUrl } = req.body;  // ✅ extract targetDbUrl
        const username = req.user.username;

        try {
            const project = await projectService.createProject(name, description, username, targetDbUrl);  // ✅ pass it
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

    async commit(req, res) {
        const { name } = req.params;
        const { message, snapshot, diff, prevCommitId, branchName } = req.body;
        const author = req.user.username;

        try {
            const commit = await projectService.createCommit(name, {
                message,
                snapshot,
                diff,
                prevCommitId,
                branchName,
                author
            });
            res.json({ success: true, commitId: commit.id });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
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

    async rollback(req, res) {
        try {
            const { name, commitId } = req.params;
            await projectService.rollbackProject(name, commitId);
            res.json({ message: 'Rollback successful' });
        } catch (error) {
            console.error('Rollback error:', error);
            res.status(500).json({ error: error.message, stack: error.stack });
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
}

module.exports = new ProjectController(); const projectService = require('../services/projectService');

class ProjectController {

    async createProject(req, res) {
        const { name, description, targetDbUrl } = req.body;  // ✅ extract targetDbUrl
        const username = req.user.username;

        try {
            const project = await projectService.createProject(name, description, username, targetDbUrl);  // ✅ pass it
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

    async commit(req, res) {
        const { name } = req.params;
        const { message, snapshot, diff, prevCommitId, branchName } = req.body;
        const author = req.user.username;

        try {
            const commit = await projectService.createCommit(name, {
                message,
                snapshot,
                diff,
                prevCommitId,
                branchName,
                author
            });
            res.json({ success: true, commitId: commit.id });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
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
        const { branch } = req.query;

        try {
            const commits = await projectService.getCommitLog(name, branch);
            res.json({ commits });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async rollback(req, res) {
        try {
            const { name, commitId } = req.params;
            await projectService.rollbackProject(name, commitId);
            res.json({ message: 'Rollback successful' });
        } catch (error) {
            console.error('Rollback error:', error);
            res.status(500).json({ error: error.message, stack: error.stack });
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
}

module.exports = new ProjectController();