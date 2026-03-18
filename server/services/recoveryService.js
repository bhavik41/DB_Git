/**
 * Member 6 — Concurrency Control: Recovery Service
 *
 * Detects and cleans up operations that were interrupted mid-flight
 * (e.g., server crash while a commit was in progress).
 *
 * Recovery strategy:
 *   - On server startup, scan CommitInProgress table
 *   - Any record whose PID is no longer alive = orphaned operation
 *   - Orphaned records are logged to FailureLog and deleted
 *   - Stale advisory locks (from dead PIDs) are force-released
 *
 * Also exposes a manual recovery scan for the `dbv recover` CLI command.
 */

const prisma = require('../configs/db');
const { listActiveLocks, forceReleaseLock } = require('./lockService');

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes — ops taking longer than this are stale

/**
 * Check if a process is still alive on this machine.
 * Works for same-host deployments (single server node).
 */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0); // signal 0 = existence check, no actual signal sent
        return true;
    } catch {
        return false; // ESRCH = no such process
    }
}

/**
 * Startup recovery scan.
 * Call this once when the server boots (before accepting requests).
 *
 * Returns a summary object with counts of what was cleaned up.
 */
async function runStartupRecovery() {
    console.log('[RecoveryService] 🔍 Running startup recovery scan...');

    const summary = {
        orphanedOpsFound: 0,
        orphanedOpsCleaned: 0,
        staleLocksReleased: 0,
        errors: [],
    };

    try {
        // ── 1. Find all in-progress operations ────────────────────────────────
        const inProgressOps = await prisma.commitInProgress.findMany({
            orderBy: { startedAt: 'asc' }
        });

        for (const op of inProgressOps) {
            const ageMs = Date.now() - new Date(op.startedAt).getTime();
            const isOrphaned = !isProcessAlive(op.pid) || ageMs > STALE_THRESHOLD_MS;

            if (isOrphaned) {
                summary.orphanedOpsFound++;
                console.warn(
                    `[RecoveryService] ⚠️  Orphaned op detected: ` +
                    `${op.author} on ${op.projectName}:${op.branchName} ` +
                    `(PID=${op.pid}, age=${Math.round(ageMs / 1000)}s)`
                );

                try {
                    // Log the failure for audit trail
                    await prisma.failureLog.create({
                        data: {
                            operation: 'commit',
                            projectName: op.projectName,
                            branchName: op.branchName,
                            author: op.author,
                            error: `Operation interrupted — PID ${op.pid} no longer alive`,
                            context: {
                                orphanedOpId: op.id,
                                startedAt: op.startedAt,
                                detectedAt: new Date().toISOString(),
                                ageMs,
                            }
                        }
                    });

                    // Remove the stale marker
                    await prisma.commitInProgress.delete({ where: { id: op.id } });
                    summary.orphanedOpsCleaned++;
                    console.log(`[RecoveryService] ✅ Cleaned orphaned op: ${op.id}`);

                } catch (err) {
                    summary.errors.push(`Failed to clean op ${op.id}: ${err.message}`);
                    console.error(`[RecoveryService] ❌ Failed to clean op ${op.id}:`, err.message);
                }
            }
        }

        // ── 2. Check for stale advisory locks ─────────────────────────────────
        const activeLocks = await listActiveLocks();

        for (const lock of activeLocks) {
            if (!isProcessAlive(lock.pid)) {
                console.warn(`[RecoveryService] ⚠️  Stale advisory lock from dead PID ${lock.pid}`);
                try {
                    const terminated = await forceReleaseLock(lock.pid);
                    if (terminated) {
                        summary.staleLocksReleased++;
                        console.log(`[RecoveryService] ✅ Force-released lock from PID ${lock.pid}`);
                    }
                } catch (err) {
                    summary.errors.push(`Failed to release lock from PID ${lock.pid}: ${err.message}`);
                }
            }
        }

    } catch (err) {
        console.error('[RecoveryService] ❌ Startup recovery scan failed:', err.message);
        summary.errors.push(err.message);
    }

    // ── Summary report ─────────────────────────────────────────────────────────
    if (summary.orphanedOpsFound === 0 && summary.staleLocksReleased === 0) {
        console.log('[RecoveryService] ✅ No orphaned operations found. System is clean.');
    } else {
        console.log(
            `[RecoveryService] Recovery complete: ` +
            `${summary.orphanedOpsCleaned}/${summary.orphanedOpsFound} ops cleaned, ` +
            `${summary.staleLocksReleased} locks released.`
        );
    }

    return summary;
}

/**
 * Manual recovery scan — called by `dbv recover` CLI command via API.
 * Same logic as startup scan but returns detailed info for display.
 */
async function getRecoveryStatus() {
    const inProgressOps = await prisma.commitInProgress.findMany({
        orderBy: { startedAt: 'asc' }
    });

    const activeLocks = await listActiveLocks();

    const ops = inProgressOps.map(op => {
        const ageMs = Date.now() - new Date(op.startedAt).getTime();
        return {
            id: op.id,
            projectName: op.projectName,
            branchName: op.branchName,
            author: op.author,
            pid: op.pid,
            startedAt: op.startedAt,
            ageSeconds: Math.round(ageMs / 1000),
            isProcessAlive: isProcessAlive(op.pid),
            isStale: !isProcessAlive(op.pid) || ageMs > STALE_THRESHOLD_MS,
        };
    });

    const recentFailures = await prisma.failureLog.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 20,
    });

    return {
        inProgressOps: ops,
        staleOpsCount: ops.filter(o => o.isStale).length,
        activeAdvisoryLocks: activeLocks.length,
        recentFailures,
    };
}

/**
 * Force-clean a specific orphaned operation by ID.
 * Used by `dbv recover --force <op-id>`.
 */
async function forceCleanOperation(opId) {
    const op = await prisma.commitInProgress.findUnique({ where: { id: opId } });
    if (!op) throw new Error(`Operation ${opId} not found`);

    await prisma.failureLog.create({
        data: {
            operation: 'commit',
            projectName: op.projectName,
            branchName: op.branchName,
            author: op.author,
            error: `Manually force-cleaned via dbv recover`,
            context: { forcedAt: new Date().toISOString(), originalOpId: opId }
        }
    });

    await prisma.commitInProgress.delete({ where: { id: opId } });
    return op;
}

module.exports = {
    runStartupRecovery,
    getRecoveryStatus,
    forceCleanOperation,
};
