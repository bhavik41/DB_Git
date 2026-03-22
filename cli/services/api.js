const axios = require('axios');
// const readline = require('readline-sync'); // Interaction moved to command layer
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