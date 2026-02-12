const { Client } = require('pg');
const prisma = require('../configs/db');

class ProjectService {

    async createProject(name, description, username, targetDbUrl) {
        // Find user — if not found, throw a clear error instead of trying to create
        // a broken user record. The user must exist (they're authenticated via JWT).
        let user = await prisma.user.findFirst({ where: { username } });

        if (!user) {
            // This means the user authenticated successfully (valid JWT) but their
            // DB record was deleted. Re-create them with a placeholder email.
            user = await prisma.user.create({
                data: {
                    username,
                    email: `${username}@github.placeholder`,  // email is required in schema
                    password: null
                }
            });
            console.warn(`[ProjectService] Re-created missing user record for: ${username}`);
        }

        // Upsert project — update if exists, create if not
        const project = await prisma.project.upsert({
            where: { name },
            update: {
                description,
                ...(targetDbUrl && { targetDbUrl }),
                userId: user.id  // re-link in case user was re-created
            },
            create: {
                name,
                description,
                targetDbUrl,
                userId: user.id
            }
        });

        // Ensure default 'main' branch exists
        await prisma.branch.upsert({
            where: { projectId_name: { projectId: project.id, name: 'main' } },
            update: {},
            create: { name: 'main', projectId: project.id }
        });

        return project;
    }

    async getProjectByName(name) {
        return prisma.project.findUnique({
            where: { name },
            include: { branches: true }
        });
    }

    async createCommit(projectName, { message, snapshot, diff, prevCommitId, branchName, author }) {
        const project = await prisma.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        const branch = await prisma.branch.upsert({
            where: { projectId_name: { projectId: project.id, name: branchName || 'main' } },
            update: {},
            create: { name: branchName || 'main', projectId: project.id }
        });

        const commit = await prisma.commit.create({
            data: {
                message,
                author,
                snapshot,
                diff,
                projectId: project.id,
                branchId: branch.id,
                prevCommitId: prevCommitId || branch.headCommitId || null
            }
        });

        await prisma.branch.update({
            where: { id: branch.id },
            data: { headCommitId: commit.id }
        });

        return commit;
    }

    async getLatestCommit(projectName, branchName = 'main') {
        const project = await prisma.project.findUnique({ where: { name: projectName } });
        if (!project) return null;

        const branch = await prisma.branch.findUnique({
            where: { projectId_name: { projectId: project.id, name: branchName } }
        });

        if (!branch || !branch.headCommitId) return null;

        return prisma.commit.findUnique({ where: { id: branch.headCommitId } });
    }

    async getCommitById(projectName, commitId) {
        const project = await prisma.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        return prisma.commit.findFirst({
            where: {
                projectId: project.id,
                id: { startsWith: commitId }
            }
        });
    }


}

module.exports = new ProjectService();