const axios = require('axios');
const readline = require('readline-sync');
const configManager = require('../utils/config');

class ApiService {
    constructor() {
        this.client = axios.create({
            baseURL: 'http://localhost:3000',
            timeout: 10000
        });
    }

    async init(apiUrl = null) {
        const globalConfig = configManager.getGlobalConfig();
        const localConfig = configManager.getConfig();

        const baseURL = apiUrl || localConfig?.apiUrl || globalConfig?.apiUrl || 'http://localhost:3000';
        this.client.defaults.baseURL = baseURL;

        if (globalConfig?.token) {
            this.client.defaults.headers.common['Authorization'] = `Bearer ${globalConfig.token}`;
        } else {
            delete this.client.defaults.headers.common['Authorization'];
        }
    }

    async createProject(name, description, targetDbUrl) {
        await this.init();
        return this.client.post('/projects', { name, description, targetDbUrl });
    }

    async getLatestCommit(projectName, branch = 'main') {
        await this.init();
        return this.client.get(`/projects/${projectName}/commits/latest`, {
            params: { branch }
        });
    }

    async pushCommit(projectName, payload) {
        await this.init();
        return this.client.post(`/projects/${projectName}/commits`, payload);
    }

    async getLog(projectName, branch = 'main') {
        await this.init();
        return this.client.get(`/projects/${projectName}/log`, {
            params: { branch }
        });
    }

    async getCommit(projectName, commitId) {
        await this.init();
        return this.client.get(`/projects/${projectName}/commits/${commitId}`);
    }

    async rollback(projectName, commitId) {
        await this.init();

        // ── Step 1: Fetch the target commit to check if dataDump exists ──────
        let targetCommit = null;
        try {
            const res = await this.client.get(`/projects/${projectName}/commits/${commitId}`);
            targetCommit = res.data;
        } catch (err) {
            console.log('\x1b[33m⚠️  Warning: Could not verify commit data snapshot status.\x1b[0m');
        }

        // ── Step 2: Warn user if no dataDump (only schema will be restored) ──
        const hasDataDump = targetCommit && targetCommit.dataDump;

        console.log('\n\x1b[33m⚠️  WARNING: Rollback is Destructive!\x1b[0m');
        console.log('\x1b[90m  • All current tables will be DROPPED and recreated from the target commit snapshot.\x1b[0m');

        if (!hasDataDump) {
            console.log('\x1b[31m  • DATA WILL NOT BE RESTORED: This commit has no data snapshot.\x1b[0m');
            console.log('\x1b[31m    Your tables will be recreated but will be EMPTY after rollback.\x1b[0m');
            console.log('\x1b[31m    (Data snapshot was either not captured or failed during this commit)\x1b[0m');
        } else {
            console.log('\x1b[32m  • Data snapshot found — records will be restored from this commit.\x1b[0m');
        }

        console.log('');

        // ── Step 3: Ask for confirmation ─────────────────────────────────────
        const confirm = readline.question(
            'This will overwrite your current schema. Continue? (yes/no): '
        );

        if (confirm !== 'yes') {
            console.log('Rollback cancelled.');
            return;
        }

        return this.client.post(`/projects/${projectName}/rollback/${commitId}`);
    }

    async createBranch(projectName, branchName, startCommitId) {
        await this.init();
        return this.client.post(`/projects/${projectName}/branches`, { branchName, startCommitId });
    }

    async getBranches(projectName) {
        await this.init();
        return this.client.get(`/projects/${projectName}/branches`);
    }
}

module.exports = new ApiService();