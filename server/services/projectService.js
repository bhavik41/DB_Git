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

    async getCommitLog(projectName, limit = 20) {
        const project = await prisma.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        return prisma.commit.findMany({
            where: { projectId: project.id },
            orderBy: { createdAt: 'desc' },
            take: limit
        });
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

    async rollbackProject(projectName, commitId) {
        console.log('🔍 Rolling back:', projectName, 'to commit:', commitId);

        const project = await prisma.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        if (!project.targetDbUrl) {
            throw new Error(`No target DB URL configured for "${projectName}". Re-run "dbv init" with the -d flag.`);
        }

        // Support short commit IDs
        const commit = await prisma.commit.findFirst({
            where: { id: { startsWith: commitId } }
        });
        if (!commit) throw new Error(`Commit "${commitId}" not found`);

        const snapshot = commit.snapshot;
        if (!snapshot || !snapshot.tables) {
            throw new Error('Commit snapshot is empty or malformed');
        }

        const client = new Client({ connectionString: project.targetDbUrl });
        await client.connect();
        console.log('✅ Connected to target DB');

        try {
            await client.query('BEGIN');

            // Drop all existing public tables
            const { rows: existingTables } = await client.query(`
                SELECT tablename FROM pg_tables WHERE schemaname = 'public'
            `);
            for (const { tablename } of existingTables) {
                await client.query(`DROP TABLE IF EXISTS "${tablename}" CASCADE`);
            }

            // Recreate tables from snapshot
            for (const [tableName, tableDef] of Object.entries(snapshot.tables)) {
                if (tableName === '_prisma_migrations') continue;

                if (!tableDef.columns || Object.keys(tableDef.columns).length === 0) {
                    console.warn(`⚠️  Skipping table "${tableName}" — no columns in snapshot`);
                    continue;
                }

                const columns = Object.entries(tableDef.columns)
                    .map(([colName, colDef]) => `"${colName}" ${colDef.type}`)
                    .join(', ');

                console.log(`📋 Creating table: ${tableName}`);
                await client.query(`CREATE TABLE "${tableName}" (${columns})`);

                // Restore rows if snapshot includes data
                if (tableDef.rows && tableDef.rows.length > 0) {
                    for (const row of tableDef.rows) {
                        const cols = Object.keys(row).map(c => `"${c}"`).join(', ');
                        const vals = Object.values(row).map((_, i) => `$${i + 1}`).join(', ');
                        const values = Object.values(row);
                        await client.query(
                            `INSERT INTO "${tableName}" (${cols}) VALUES (${vals})`,
                            values
                        );
                    }
                    console.log(`📥 Restored ${tableDef.rows.length} rows into "${tableName}"`);
                }
            }

            await client.query('COMMIT');
            console.log('✅ Rollback committed successfully');

        } catch (err) {
            await client.query('ROLLBACK');
            console.error('❌ Rollback failed, transaction rolled back:', err.message);
            throw err;
        } finally {
            await client.end();
        }
    }
}

module.exports = new ProjectService();