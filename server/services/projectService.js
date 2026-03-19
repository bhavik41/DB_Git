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

    async createCommit(projectName, { message, snapshot, dataDump, diff, prevCommitId, branchName, author }) {
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
                dataDump,
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

    async rollback(projectName, commitId) {
        const project = await this.getProjectByName(projectName);
        if (!project) throw new Error(`Project "${projectName}" not found`);
        if (!project.targetDbUrl) throw new Error(`Target Database URL not configured for project "${projectName}"`);

        const commit = await this.getCommitById(projectName, commitId);
        if (!commit) throw new Error(`Commit "${commitId}" not found`);

        const targetDbUrl = project.targetDbUrl;

        if (commit.dataDump) {
            console.log(`[Rollback] Restoring full data snapshot for commit: ${commitId}`);
            const client = new Client({ connectionString: targetDbUrl });
            await client.connect();
            try {
                // Execute the entire dump SQL. 
                // Note: --clean in pg_dump adds DROP statements.
                await client.query(commit.dataDump);
                console.log(`[Rollback] Data restore finished for commit: ${commitId}`);
                return;
            } catch (error) {
                const fs = require('fs');
                fs.writeFileSync('rollback_error.log', `Error: ${error.message}\nStack: ${error.stack}\nSQL: ${commit.dataDump.substring(0, 500)}...`);
                console.error(`[Rollback Error] Data restore failed: ${error.message}`);
                throw error;
            } finally {
                await client.end();
            }
        }

        // Fallback to structural reconstruction (original logic)
        const targetSnapshot = commit.snapshot;
        const currentSnapshot = await this._introspect(targetDbUrl);

        const client = new Client({ connectionString: targetDbUrl });
        await client.connect();

        try {
            await client.query('BEGIN');

            // 1. Drop tables that shouldn't be there
            for (const tableName of Object.keys(currentSnapshot.tables)) {
                if (!targetSnapshot.tables[tableName]) {
                    await client.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
                }
            }

            // 2. Reconstruct tables from snapshot
            for (const [tableName, tableDef] of Object.entries(targetSnapshot.tables)) {
                await client.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);

                const colDefs = Object.entries(tableDef.columns).map(([colName, col]) => {
                    let def = `"${colName}" ${col.type}`;
                    if (!col.nullable) def += ' NOT NULL';
                    if (col.default) def += ` DEFAULT ${col.default}`;
                    return def;
                });

                const pkDef = tableDef.primaryKey ? `, PRIMARY KEY ("${tableDef.primaryKey.join('", "')}")` : '';
                await client.query(`CREATE TABLE "${tableName}" (${colDefs.join(', ')}${pkDef})`);
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            await client.end();
        }
    }

    // Helper to mirror CLI's introspection if needed (or we could expose it via API)
    async _introspect(dbUrl) {
        // This is a placeholder since the CLI usually does the introspection.
        // But for a true server-side rollback, the server must be able to see the target DB
        // or the client must send the "current" state.
        // Assuming the server can reach it as per targetDbUrl.
        const client = new Client({ connectionString: dbUrl });
        await client.connect();
        try {
            const res = await client.query(`
                SELECT table_name, column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema = 'public'
            `);
            const tables = {};
            res.rows.forEach(row => {
                if (!tables[row.table_name]) tables[row.table_name] = { columns: {} };
                tables[row.table_name].columns[row.column_name] = {
                    type: row.data_type,
                    nullable: row.is_nullable === 'YES',
                    default: row.column_default
                };
            });
            return { tables };
        } finally {
            await client.end();
        }
    }
}

module.exports = new ProjectService();