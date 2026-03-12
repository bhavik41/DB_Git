const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const NodeCache = require('node-cache');

// Standard TTL 60s, check every 120s
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

class ProjectService {

    async createProject(name, description, ownerUsername, targetDbUrl) {
        // First find the user
        const user = await prisma.user.findUnique({
            where: { username: ownerUsername }
        });

        if (!user) throw new Error('User not found');

        return await prisma.project.create({
            data: {
                name,
                description,
                userId: user.id,
                targetDbUrl: targetDbUrl || process.env.DATABASE_URL
            }
        });
    }

    async getProjectByName(projectName) {
        const cacheKey = `project_${projectName}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const project = await prisma.project.findUnique({
            where: { name: projectName },
            include: { branches: true }
        });

        if (project) {
            cache.set(cacheKey, project);
        }
        return project;
    }

    async createCommit(projectName, { message, snapshot, diff, prevCommitId, branchName, author }) {
        const project = await this.getProjectByName(projectName);
        if (!project) throw new Error('Project not found');

        let branch = project.branches.find(b => b.name === (branchName || 'main'));
        if (!branch) {
            branch = await this.createBranch(projectName, branchName || 'main', prevCommitId);
        }

        const commit = await prisma.commit.create({
            data: {
                message,
                snapshot,
                diff,
                prevCommitId,
                branchId: branch.id,
                projectId: project.id,
                author
            }
        });

        // Update branch HEAD
        await prisma.branch.update({
            where: { id: branch.id },
            data: { headCommitId: commit.id }
        });

        // Invalidate cache
        cache.del(`project_${projectName}`);
        cache.del(`branches_${project.id}`);

        return commit;
    }

    async getLatestCommit(projectName, branchName = 'main') {
        const project = await this.getProjectByName(projectName);
        if (!project) throw new Error('Project not found');

        const branch = await prisma.branch.findFirst({
            where: { projectId: project.id, name: branchName }
        });

        if (!branch || !branch.headCommitId) return null;

        return await prisma.commit.findUnique({
            where: { id: branch.headCommitId }
        });
    }

    async getCommitById(projectName, commitId) {
        // Support searching by prefix (Member 5 optimization)
        if (commitId.length < 36) {
            const commits = await prisma.commit.findMany({
                where: { id: { startsWith: commitId } },
                take: 1
            });
            return commits[0] || null;
        }

        return await prisma.commit.findUnique({
            where: { id: commitId }
        });
    }

    async getCommitLog(projectName, branchName = 'main', limit = 50, cursor = null) {
        const project = await this.getProjectByName(projectName);
        const branch = await prisma.branch.findFirst({
            where: { projectId: project.id, name: branchName }
        });

        if (!branch) return [];

        return await prisma.commit.findMany({
            where: {
                projectId: project.id,
                branchId: branch.id
            },
            take: limit,
            skip: cursor ? 1 : 0,
            cursor: cursor ? { id: cursor } : undefined,
            orderBy: { createdAt: 'desc' },
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
        const project = await this.getProjectByName(projectName);
        if (!project) throw new Error('Project not found');

        const branch = await prisma.branch.create({
            data: {
                name: branchName,
                projectId: project.id,
                headCommitId: startCommitId
            }
        });

        // Invalidate cache
        cache.del(`project_${projectName}`);
        cache.del(`branches_${project.id}`);

        return branch;
    }

    async listBranches(projectIdentifier) {
        let projectId = projectIdentifier;
        if (typeof projectIdentifier === 'string') {
            const project = await this.getProjectByName(projectIdentifier);
            if (!project) return [];
            projectId = project.id;
        }

        const cacheKey = `branches_${projectId}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const branches = await prisma.branch.findMany({
            where: { projectId },
            include: {
                headCommit: {
                    select: { message: true, createdAt: true }
                }
            }
        });

        cache.set(cacheKey, branches);
        return branches;
    }

    async rollbackProject(projectName, targetCommitId) {
        const commit = await this.getCommitById(projectName, targetCommitId);
        if (!commit) throw new Error('Commit not found');
        return commit;
    }

    async getStorageStats(projectName) {
        const project = await this.getProjectByName(projectName);
        if (!project) throw new Error('Project not found');

        const commits = await prisma.commit.findMany({
            where: { projectId: project.id },
            select: {
                id: true,
                message: true,
                snapshot: true,
                diff: true,
                createdAt: true
            },
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
            if (diffSize > 0) {
                totalDiffSize += diffSize;
                diffCount++;
            }

            perCommitAnalysis.push({
                commitId: c.id.substring(0, 8),
                message: c.message,
                snapshotSizeBytes: snapSize,
                diffSizeBytes: diffSize,
                hasDiff: diffSize > 0
            });
        });

        const avgSnapshot = commits.length > 0 ? totalSnapshotSize / commits.length : 0;
        const snapshotOnlyTotal = totalSnapshotSize; // All snapshots
        const migrationReplayTotal = totalDiffSize; // Only diffs (unrealistic but benchmarking)
        const hybridTotal = avgSnapshot + totalDiffSize; // 1 baseline + all diffs

        // Recommendation logic
        let recommendation = 'KEEP_AS_IS: Your current strategy is optimal for this project volume.';
        if (commits.length > 10 && (snapshotOnlyTotal > hybridTotal * 1.5)) {
            recommendation = `SWITCH_TO_HYBRID: Switching to Hybrid (1 baseline + diffs) would save ~${Math.round((1 - hybridTotal / snapshotOnlyTotal) * 100)}% storage.`;
        }

        return {
            projectName: project.name,
            totalCommits: commits.length,
            commitsWithDiff: diffCount,
            commitsWithoutDiff: commits.length - diffCount,
            storageBreakdown: {
                snapshotOnlyKB: (snapshotOnlyTotal / 1024).toFixed(2),
                migrationReplayKB: (migrationReplayTotal / 1024).toFixed(2),
                hybridKB: (hybridTotal / 1024).toFixed(2)
            },
            recommendation,
            perCommitAnalysis
        };
    }

    async getIndexAnalysis() {
        const { Client } = require('pg');
        const prisma_db_url = process.env.DATABASE_URL;
        if (!prisma_db_url) throw new Error('DATABASE_URL not configured');

        const client = new Client({ connectionString: prisma_db_url });
        await client.connect();

        const queries = [
            {
                name: 'commit_history_by_project_branch',
                description: 'Fetch latest 50 commits for a project+branch (hot path: dbv log)',
                sql: `EXPLAIN (FORMAT JSON, ANALYZE false) SELECT id, message, author, \"createdAt\", \"prevCommitId\", \"branchId\", \"projectId\" FROM \"Commit\" WHERE \"projectId\" = 1 AND \"branchId\" = 1 ORDER BY \"createdAt\" DESC LIMIT 50`
            },
            {
                name: 'commit_by_id_prefix',
                description: 'Fetch a single commit by UUID prefix (hot path: dbv rollback, dbv checkout)',
                sql: `EXPLAIN (FORMAT JSON, ANALYZE false) SELECT * FROM \"Commit\" WHERE id LIKE '00000000%' LIMIT 1`
            },
            {
                name: 'branch_head_resolution',
                description: 'Resolve branch HEAD for a project (hot path: every commit/push)',
                sql: `EXPLAIN (FORMAT JSON, ANALYZE false) SELECT id, name, \"headCommitId\" FROM \"Branch\" WHERE \"projectId\" = 1 AND name = 'main'`
            },
            {
                name: 'project_lookup_by_name',
                description: 'Lookup project by name (hot path: every CLI command)',
                sql: `EXPLAIN (FORMAT JSON, ANALYZE false) SELECT id, name FROM \"Project\" WHERE name = 'example-project'`
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
        const { Client } = require('pg');
        const prisma_db_url = process.env.DATABASE_URL;
        if (!prisma_db_url) throw new Error('DATABASE_URL not configured');

        const client = new Client({ connectionString: prisma_db_url });
        await client.connect();

        try {
            const cacheQuery = await client.query(`
                SELECT 
                    sum(blks_hit) * 100 / nullif(sum(blks_hit) + sum(blks_read), 0) as cache_hit_ratio_percent
                FROM pg_stat_database 
                WHERE datname = current_database();
            `);
            const cacheHitRatio = parseFloat(cacheQuery.rows[0]?.cache_hit_ratio_percent || 0).toFixed(2);

            const indexQuery = await client.query(`
                SELECT 
                    relname as table_name,
                    indexrelname as index_name,
                    idx_scan as number_of_scans,
                    idx_tup_read as tuples_read,
                    idx_tup_fetch as tuples_fetched
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
        const { Client } = require('pg');
        const prisma_db_url = process.env.DATABASE_URL;
        if (!prisma_db_url) throw new Error('DATABASE_URL not configured');
        const client = new Client({ connectionString: prisma_db_url });
        await client.connect();
        try {
            const result = await client.query(`
                SELECT
                    relname AS table_name,
                    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
                    pg_relation_size(relid)                       AS table_bytes,
                    pg_indexes_size(relid)                        AS index_bytes,
                    pg_size_pretty(pg_relation_size(relid))       AS table_size,
                    pg_size_pretty(pg_indexes_size(relid))        AS index_size,
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

module.exports = new ProjectService(); const { Client } = require('pg');
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

        const branch = await prisma.branch.findUnique({
            where: { projectId_name: { projectId: project.id, name: branchName || 'main' } }
        });

        if (!branch) {
            throw new Error(`Branch "${branchName || 'main'}" not found in project "${projectName}"`);
        }

        // Merge-safety check: if prevCommitId is provided, it MUST match the current branch head.
        // This prevents "lost updates" if multiple people are committing to the same branch.
        if (prevCommitId && branch.headCommitId && prevCommitId !== branch.headCommitId) {
            throw new Error(`Branch "${branchName}" has diverged. Current head is [${branch.headCommitId.substring(0, 8)}], but your commit parent is [${prevCommitId.substring(0, 8)}]. Please pull latest changes before committing.`);
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

    async createBranch(projectName, branchName, startCommitId) {
        const project = await prisma.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        const existingBranch = await prisma.branch.findUnique({
            where: { projectId_name: { projectId: project.id, name: branchName } }
        });

        if (existingBranch) {
            throw new Error(`Branch "${branchName}" already exists`);
        }

        // If no startCommitId provided, use the head of 'main'
        let headId = startCommitId;
        if (!headId) {
            const mainBranch = await prisma.branch.findUnique({
                where: { projectId_name: { projectId: project.id, name: 'main' } }
            });
            headId = mainBranch ? mainBranch.headCommitId : null;
        }

        const branch = await prisma.branch.create({
            data: {
                name: branchName,
                projectId: project.id,
                headCommitId: headId
            }
        });

        return branch;
    }

    async listBranches(projectName) {
        const project = await prisma.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        return prisma.branch.findMany({
            where: { projectId: project.id },
            include: {
                commits: {
                    orderBy: { createdAt: 'desc' },
                    take: 1
                }
            }
        });
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

    async getCommitLog(projectName, branchName = 'main', limit = 20) {
        const project = await prisma.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        const branch = await prisma.branch.findUnique({
            where: { projectId_name: { projectId: project.id, name: branchName } }
        });

        const where = { projectId: project.id };
        if (branch) {
            where.branchId = branch.id;
        }

        return prisma.commit.findMany({
            where,
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