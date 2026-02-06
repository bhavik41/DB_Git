const prisma = require('../configs/db');

class ProjectService {
    /**
     * Create or retrieve a project by name.
     * Ensures the associated user exists (mocked for now).
     */
    async createProject(name, description, username) {
        // Check/Create User (Mock Auth)
        let user = await prisma.user.findFirst({ where: { username } });
        if (!user) {
            user = await prisma.user.create({
                data: { username, password: 'password' }
            });
        }

        // Upsert Project (Create if doesn't exist, update if it does)
        const project = await prisma.project.upsert({
            where: { name },
            update: { description },
            create: {
                name,
                description,
                userId: user.id
            }
        });

        return project;
    }

    async getProjectByName(name) {
        return prisma.project.findUnique({
            where: { name },
            include: { branches: true }
        });
    }

}

module.exports = new ProjectService();
