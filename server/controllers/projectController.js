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


}

module.exports = new ProjectController();
