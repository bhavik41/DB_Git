/**
 * Member 6 — Concurrency Control: Transaction Service
 *
 * Wraps commit and rollback operations in Prisma interactive transactions
 * with in-progress tracking for crash recovery.
 *
 * Design principles:
 *   1. ATOMICITY  — commit metadata + branch HEAD update happen together or not at all
 *   2. ISOLATION  — advisory lock (lockService) prevents concurrent writes; this service
 *                   handles the DB-level transaction boundary
 *   3. DURABILITY — Prisma transactions use PostgreSQL's WAL; COMMIT is only called
 *                   after all writes succeed
 *   4. RECOVERY   — CommitInProgress records let recoveryService detect crashed ops
 */

const prisma = require('../configs/db');

/**
 * Execute a commit atomically with in-progress tracking.
 *
 * Steps inside the transaction:
 *   1. Write CommitInProgress record (crash recovery marker)
 *   2. Validate branch head hasn't moved (double-check after lock)
 *   3. Create Commit record
 *   4. Update Branch.headCommitId
 *   5. Delete CommitInProgress record (clean exit)
 *
 * If any step fails → Prisma rolls back the entire transaction,
 * and the CommitInProgress record is cleaned up by recoveryService on next start.
 */
async function atomicCommit(projectName, { message, snapshot, dataDump, diff, prevCommitId, branchName, author }) {
    const branch_name = branchName || 'main';

    // Prisma interactive transaction with a generous timeout (30s for large schemas)
    const result = await prisma.$transaction(async (tx) => {

        // ── Step 1: Fetch project & branch inside transaction ──────────────────
        const project = await tx.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        const branch = await tx.branch.findUnique({
            where: { projectId_name: { projectId: project.id, name: branch_name } }
        });
        if (!branch) throw new Error(`Branch "${branch_name}" not found`);

        // ── Step 2: Write in-progress marker ──────────────────────────────────
        const inProgress = await tx.commitInProgress.create({
            data: {
                projectName,
                branchName: branch_name,
                author: author || 'unknown',
                pid: process.pid,
            }
        });

        // ── Step 3: Final divergence check (inside transaction) ───────────────
        // Advisory lock prevents concurrent access, but this is a second safety net.
        if (prevCommitId && branch.headCommitId && prevCommitId !== branch.headCommitId) {
            throw new Error(
                `Branch "${branch_name}" head moved during lock acquisition. ` +
                `Expected [${prevCommitId.substring(0, 8)}] but found [${branch.headCommitId.substring(0, 8)}]. ` +
                `Pull latest changes and retry.`
            );
        }

        // ── Step 4: Create commit ──────────────────────────────────────────────
        const commit = await tx.commit.create({
            data: {
                message,
                author: author || 'unknown',
                snapshot,
                dataDump, // Member 7 Fix: included dataDump
                diff: diff || [],
                projectId: project.id,
                branchId: branch.id,
                prevCommitId: prevCommitId || branch.headCommitId || null,
            }
        });

        // ── Step 5: Advance branch HEAD ────────────────────────────────────────
        await tx.branch.update({
            where: { id: branch.id },
            data: { headCommitId: commit.id }
        });

        // ── Step 6: Remove in-progress marker (clean exit) ────────────────────
        await tx.commitInProgress.delete({ where: { id: inProgress.id } });

        return commit;

    }, {
        maxWait: 10000,   // wait up to 10s to acquire Prisma's internal connection
        timeout: 30000,   // transaction must complete within 30s
        isolationLevel: 'Serializable', // strongest isolation: prevents phantom reads
    });

    return result;
}

/**
 * Execute a rollback atomically with in-progress tracking.
 *
 * Rollback touches the target database (not the metadata DB), so we:
 *   1. Record intent in metadata DB (CommitInProgress)
 *   2. Apply schema reconstruction on target DB (passed in as a callback)
 *   3. Update branch HEAD in metadata DB
 *   4. Clear in-progress marker
 *
 * The target DB operation is NOT inside the Prisma transaction (different DB),
 * but we use savepoint-style recovery: if target DB fails, metadata is untouched.
 */
async function atomicRollback(projectName, targetCommitId, applySchemaFn) {
    // ── Phase 1: Validate and record intent in metadata DB ────────────────────
    let inProgressId = null;
    let project, targetCommit, branch;

    await prisma.$transaction(async (tx) => {
        project = await tx.project.findUnique({ where: { name: projectName } });
        if (!project) throw new Error(`Project "${projectName}" not found`);

        targetCommit = await tx.commit.findFirst({
            where: { projectId: project.id, id: { startsWith: targetCommitId } }
        });
        if (!targetCommit) throw new Error(`Commit "${targetCommitId}" not found`);

        branch = await tx.branch.findUnique({
            where: { id: targetCommit.branchId }
        });

        const inProgress = await tx.commitInProgress.create({
            data: {
                projectName,
                branchName: branch?.name || 'main',
                author: 'rollback',
                pid: process.pid,
            }
        });
        inProgressId = inProgress.id;
    });

    // ── Phase 2: Apply schema changes on target DB (outside metadata tx) ──────
    try {
        await applySchemaFn(targetCommit);
    } catch (err) {
        // Target DB failed — clean up the in-progress marker and rethrow
        await prisma.commitInProgress.deleteMany({ where: { id: inProgressId } });
        throw new Error(`Schema reconstruction failed: ${err.message}`);
    }

    // ── Phase 3: Update metadata DB branch HEAD ────────────────────────────────
    await prisma.$transaction(async (tx) => {
        if (branch) {
            await tx.branch.update({
                where: { id: branch.id },
                data: { headCommitId: targetCommit.id }
            });
        }
        await tx.commitInProgress.delete({ where: { id: inProgressId } });
    });

    return targetCommit;
}

/**
 * Log a failed operation for audit/recovery purposes.
 */
async function logFailure(operation, projectName, branchName, author, error, context = {}) {
    try {
        await prisma.failureLog.create({
            data: {
                operation,
                projectName,
                branchName,
                author,
                error: error.message || String(error),
                context,
            }
        });
    } catch (logErr) {
        // Never let failure logging crash the caller
        console.error('[TransactionService] Failed to write failure log:', logErr.message);
    }
}

module.exports = {
    atomicCommit,
    atomicRollback,
    logFailure,
};
