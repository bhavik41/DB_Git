const projectService = require('../services/projectService');

class ProjectController {
    async createProject(req, res) {
        const { name, description } = req.body;
        const username = req.user.username; // From mock auth middleware

        try {
            const project = await projectService.createProject(name, description, username);
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


}

module.exports = new ProjectController();
