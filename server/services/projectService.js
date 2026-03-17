const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');

// Use configs/db if it exists, otherwise create directly
let prisma;
try {
    prisma = require('../configs/db');
} catch {
    prisma = new PrismaClient();
}

class ProjectService {

    async createProject(name, description, username, targetDbUrl) {
        let user = await prisma.user.findFirst({ where: { username } });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    username,
                    email: `${username}@github.placeholder`,
                    password: null
                }
            });
            console.warn(`[ProjectService] Re-created missing user record for: ${username}`);
        }

        const project = await prisma.project.upsert({
            where: { name },
            update: {
                description,
                ...(targetDbUrl && { targetDbUrl }),
                userId: user.id
            },
            create: { name, description, targetDbUrl, userId: user.id }
        });

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

        const branch = await prisma.branch.findUnique({
            where: { projectId_name: { projectId: project.id, name: branchName || 'main' } }
        });

        if (!branch) {
            throw new Error(`Branch "${branchName || 'main'}" not found in project "${projectName}"`);
        }

        if (prevCommitId && branch.headCommitId && prevCommitId !== branch.headCommitId) {
            throw new Error(
                `Branch "${branchName}" has diverged. Current head is [${branch.headCommitId.substring(0, 8)}], ` +
                `but your commit parent is [${prevCommitId.substring(0, 8)}]. Please pull latest changes before committing.`
            );
        }

        const commit = await prisma.commit.create({
            data: {
                message,
                author,
                snapshot,
                diff: diff || [],
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
            where: { projectId: project.id, id: { startsWith: commitId } }
        });
    }

    async getCommitLog(projectName, branchName = 'main', limit = 50, cursor = null) {
        const project = await prisma.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        const branch = await prisma.branch.findUnique({
            where: { projectId_name: { projectId: project.id, name: branchName } }
        });

        const where = { projectId: project.id };
        if (branch) where.branchId = branch.id;

        return prisma.commit.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: cursor ? 1 : 0,
            cursor: cursor ? { id: cursor } : undefined,
            select: {
                id: true,
                message: true,
                author: true,
                createdAt: true,
                prevCommitId: true,
                branchId: true,
                projectId: true
            }
        });
    }

    async createBranch(projectName, branchName, startCommitId) {
        const project = await prisma.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        const existingBranch = await prisma.branch.findUnique({
            where: { projectId_name: { projectId: project.id, name: branchName } }
        });

        if (existingBranch) throw new Error(`Branch "${branchName}" already exists`);

        let headId = startCommitId;
        if (!headId) {
            const mainBranch = await prisma.branch.findUnique({
                where: { projectId_name: { projectId: project.id, name: 'main' } }
            });
            headId = mainBranch ? mainBranch.headCommitId : null;
        }

        return prisma.branch.create({
            data: { name: branchName, projectId: project.id, headCommitId: headId }
        });
    }

    async listBranches(projectName) {
        const project = await prisma.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        return prisma.branch.findMany({
            where: { projectId: project.id },
            include: {
                commits: { orderBy: { createdAt: 'desc' }, take: 1 }
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

            const { rows: existingTables } = await client.query(
                `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
            );
            for (const { tablename } of existingTables) {
                await client.query(`DROP TABLE IF EXISTS "${tablename}" CASCADE`);
            }

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

                if (tableDef.rows && tableDef.rows.length > 0) {
                    for (const row of tableDef.rows) {
                        const cols = Object.keys(row).map(c => `"${c}"`).join(', ');
                        const vals = Object.values(row).map((_, i) => `$${i + 1}`).join(', ');
                        await client.query(
                            `INSERT INTO "${tableName}" (${cols}) VALUES (${vals})`,
                            Object.values(row)
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

    // ── M5: Storage Analysis ──────────────────────────────────────────────────

    async getStorageStats(projectName) {
        const project = await this.getProjectByName(projectName);
        if (!project) throw new Error('Project not found');

        const commits = await prisma.commit.findMany({
            where: { projectId: project.id },
            select: { id: true, message: true, snapshot: true, diff: true, createdAt: true },
            orderBy: { createdAt: 'desc' }
        });

        let totalSnapshotSize = 0;
        let totalDiffSize = 0;
        let diffCount = 0;
        const perCommitAnalysis = [];

        commits.forEach(c => {
            const snapSize = c.snapshot ? JSON.stringify(c.snapshot).length : 0;
            const diffSize = (c.diff && Object.keys(c.diff).length > 0) ? JSON.stringify(c.diff).length : 0;
            totalSnapshotSize += snapSize;
            if (diffSize > 0) { totalDiffSize += diffSize; diffCount++; }
            perCommitAnalysis.push({
                commitId: c.id.substring(0, 8),
                message: c.message,
                snapshotSizeBytes: snapSize,
                diffSizeBytes: diffSize,
                hasDiff: diffSize > 0
            });
        });

        const avgSnapshot = commits.length > 0 ? totalSnapshotSize / commits.length : 0;
        const hybridTotal = avgSnapshot + totalDiffSize;

        let recommendation = 'KEEP_AS_IS: Your current strategy is optimal for this project volume.';
        if (commits.length > 10 && totalSnapshotSize > hybridTotal * 1.5) {
            recommendation = `SWITCH_TO_HYBRID: Switching to Hybrid would save ~${Math.round((1 - hybridTotal / totalSnapshotSize) * 100)}% storage.`;
        }

        return {
            projectName: project.name,
            totalCommits: commits.length,
            commitsWithDiff: diffCount,
            commitsWithoutDiff: commits.length - diffCount,
            storageBreakdown: {
                snapshotOnlyKB: (totalSnapshotSize / 1024).toFixed(2),
                migrationReplayKB: (totalDiffSize / 1024).toFixed(2),
                hybridKB: (hybridTotal / 1024).toFixed(2)
            },
            recommendation,
            perCommitAnalysis
        };
    }

    async getIndexAnalysis() {
        const prisma_db_url = process.env.DATABASE_URL;
        if (!prisma_db_url) throw new Error('DATABASE_URL not configured');

        const client = new Client({ connectionString: prisma_db_url });
        await client.connect();

        const queries = [
            {
                name: 'commit_history_by_project_branch',
                description: 'Fetch latest 50 commits for a project+branch (hot path: dbv log)',
                sql: `EXPLAIN (FORMAT JSON, ANALYZE false) SELECT id, message, author, "createdAt", "prevCommitId", "branchId", "projectId" FROM "Commit" WHERE "projectId" = 1 AND "branchId" = 1 ORDER BY "createdAt" DESC LIMIT 50`
            },
            {
                name: 'commit_by_id_prefix',
                description: 'Fetch a single commit by UUID prefix (hot path: dbv rollback, dbv checkout)',
                sql: `EXPLAIN (FORMAT JSON, ANALYZE false) SELECT * FROM "Commit" WHERE id LIKE '00000000%' LIMIT 1`
            },
            {
                name: 'branch_head_resolution',
                description: 'Resolve branch HEAD for a project (hot path: every commit/push)',
                sql: `EXPLAIN (FORMAT JSON, ANALYZE false) SELECT id, name, "headCommitId" FROM "Branch" WHERE "projectId" = 1 AND name = 'main'`
            },
            {
                name: 'project_lookup_by_name',
                description: 'Lookup project by name (hot path: every CLI command)',
                sql: `EXPLAIN (FORMAT JSON, ANALYZE false) SELECT id, name FROM "Project" WHERE name = 'example-project'`
            }
        ];

        const results = [];
        for (const q of queries) {
            try {
                const res = await client.query(q.sql);
                const plan = res.rows[0]['QUERY PLAN'];
                const planObj = Array.isArray(plan) ? plan[0] : plan;
                const WRAPPER_NODES = new Set(['Limit', 'Sort', 'Gather', 'Gather Merge', 'Unique', 'Aggregate']);
                let node = planObj?.Plan;
                while (node && WRAPPER_NODES.has(node['Node Type']) && node['Plans']?.[0]) {
                    node = node['Plans'][0];
                }
                results.push({
                    name: q.name,
                    description: q.description,
                    planType: node?.['Node Type'] || 'unknown',
                    indexUsed: node?.['Index Name'] || null,
                    estimatedCost: planObj?.Plan?.['Total Cost'] || null,
                    raw: planObj
                });
            } catch (err) {
                results.push({ name: q.name, description: q.description, error: err.message });
            }
        }

        await client.end();
        return results;
    }

    async getSystemAnalysis() {
        const prisma_db_url = process.env.DATABASE_URL;
        if (!prisma_db_url) throw new Error('DATABASE_URL not configured');
        const client = new Client({ connectionString: prisma_db_url });
        await client.connect();
        try {
            const cacheQuery = await client.query(`
                SELECT sum(blks_hit) * 100 / nullif(sum(blks_hit) + sum(blks_read), 0) as cache_hit_ratio_percent
                FROM pg_stat_database WHERE datname = current_database();
            `);
            const cacheHitRatio = parseFloat(cacheQuery.rows[0]?.cache_hit_ratio_percent || 0).toFixed(2);
            const indexQuery = await client.query(`
                SELECT relname as table_name, indexrelname as index_name,
                    idx_scan as number_of_scans, idx_tup_read as tuples_read, idx_tup_fetch as tuples_fetched
                FROM pg_stat_user_indexes
                WHERE indexrelname LIKE '%_idx' OR indexrelname LIKE '%_key'
                ORDER BY idx_scan DESC;
            `);
            return {
                cacheHitRatio: `${cacheHitRatio}%`,
                cacheAnalysis: parseFloat(cacheHitRatio) > 90
                    ? 'Excellent memory utilization. Most reads hit cache instead of disk I/O.'
                    : 'Cache hit ratio is low. Consider tuning memory or running more queries to warm cache.',
                indexUsage: indexQuery.rows.map(row => ({
                    table: row.table_name,
                    index: row.index_name,
                    scans: parseInt(row.number_of_scans, 10),
                    tuplesRead: parseInt(row.tuples_read, 10)
                }))
            };
        } finally {
            await client.end();
        }
    }

    async getIndexEfficiencyRatio() {
        const prisma_db_url = process.env.DATABASE_URL;
        if (!prisma_db_url) throw new Error('DATABASE_URL not configured');
        const client = new Client({ connectionString: prisma_db_url });
        await client.connect();
        try {
            const result = await client.query(`
                SELECT relname AS table_name,
                    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
                    pg_size_pretty(pg_relation_size(relid)) AS table_size,
                    pg_size_pretty(pg_indexes_size(relid)) AS index_size,
                    CASE WHEN pg_total_relation_size(relid) = 0 THEN 0
                         ELSE ROUND(100.0 * pg_indexes_size(relid) / pg_total_relation_size(relid), 2)
                    END AS index_ratio_pct
                FROM pg_stat_user_tables
                WHERE LOWER(relname) IN ('commit', 'branch', 'project', 'user')
                ORDER BY pg_indexes_size(relid) DESC;
            `);
            return result.rows.map(row => ({
                table: row.table_name,
                totalSize: row.total_size,
                tableSize: row.table_size,
                indexSize: row.index_size,
                indexRatioPct: parseFloat(row.index_ratio_pct),
                verdict: parseFloat(row.index_ratio_pct) > 70
                    ? 'HIGH — consider pruning unused indexes'
                    : parseFloat(row.index_ratio_pct) > 40
                        ? 'MODERATE — acceptable for this workload'
                        : 'OPTIMAL — indexes are efficiently sized'
            }));
        } finally {
            await client.end();
        }
    }
}

module.exports = new ProjectService();