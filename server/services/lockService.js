/**
 * Member 6 — Concurrency Control: Lock Service
 *
 * Uses PostgreSQL Advisory Locks to prevent concurrent commits/rollbacks
 * on the same project+branch. Advisory locks are:
 *   - Lightweight (no table row needed)
 *   - Session-scoped (auto-released on disconnect)
 *   - Non-blocking (tryLock returns false instead of waiting forever)
 *
 * Lock key strategy:
 *   PostgreSQL advisory locks take a single BIGINT key.
 *   We derive one by hashing "projectName:branchName" → 32-bit int,
 *   which fits safely in PG's lock space.
 */

const { Pool } = require('pg');

// Dedicated pool for advisory lock connections.
// Each acquired lock needs its OWN connection held open until release.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,                  // max concurrent lock holders
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('[LockService] Idle pool client error:', err.message);
});

/**
 * Deterministic 32-bit hash of a string (djb2 algorithm).
 * Returns a positive integer safe for pg_advisory_lock (bigint range).
 */
function hashKey(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash; // convert to 32-bit int
    }
    // Ensure positive (pg advisory lock accepts any bigint, but keep readable)
    return Math.abs(hash);
}

/**
 * Build a numeric lock key from project + branch.
 * Using two separate ints (classid + objid) for namespace isolation.
 */
function getLockKey(projectName, branchName) {
    const combined = `${projectName}:${branchName}`;
    return hashKey(combined);
}

/**
 * Acquire a session-level advisory lock (NON-BLOCKING).
 *
 * Returns { acquired: true, client, lockKey } on success.
 * Returns { acquired: false } if another process holds the lock.
 *
 * IMPORTANT: On success, you MUST call releaseLock(client, lockKey)
 * when the operation completes (or errors).
 */
async function acquireLock(projectName, branchName) {
    const lockKey = getLockKey(projectName, branchName);
    const client = await pool.connect();

    try {
        // pg_try_advisory_lock returns TRUE if lock acquired, FALSE if already held
        const result = await client.query(
            'SELECT pg_try_advisory_lock($1) AS acquired',
            [lockKey]
        );

        if (result.rows[0].acquired) {
            console.log(`[LockService] 🔒 Lock acquired for "${projectName}:${branchName}" (key=${lockKey})`);
            return { acquired: true, client, lockKey };
        } else {
            client.release();
            console.warn(`[LockService] ⚠️  Lock busy for "${projectName}:${branchName}" (key=${lockKey})`);
            return { acquired: false, client: null, lockKey };
        }
    } catch (err) {
        client.release();
        throw new Error(`[LockService] Failed to acquire lock: ${err.message}`);
    }
}

/**
 * Release a previously acquired advisory lock.
 * Must be called with the same client used to acquire the lock.
 */
async function releaseLock(client, lockKey) {
    try {
        await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
        console.log(`[LockService] 🔓 Lock released (key=${lockKey})`);
    } catch (err) {
        console.error(`[LockService] Failed to release lock (key=${lockKey}):`, err.message);
    } finally {
        client.release();
    }
}

/**
 * Higher-order helper: run an async fn while holding an advisory lock.
 * Automatically releases the lock on success or error.
 *
 * Usage:
 *   const result = await withLock('my-project', 'main', async () => {
 *     return await projectService.createCommit(...);
 *   });
 */
async function withLock(projectName, branchName, fn) {
    const { acquired, client, lockKey } = await acquireLock(projectName, branchName);

    if (!acquired) {
        throw new Error(
            `Another operation is in progress on branch "${branchName}" ` +
            `of project "${projectName}". Please retry in a moment.`
        );
    }

    try {
        return await fn();
    } finally {
        await releaseLock(client, lockKey);
    }
}

/**
 * Check how many sessions currently hold advisory locks.
 * Useful for the dbv recover command.
 */
async function listActiveLocks() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT
                pid,
                granted,
                classid,
                objid,
                mode,
                locktype
            FROM pg_locks
            WHERE locktype = 'advisory' AND granted = true
            ORDER BY pid
        `);
        return result.rows;
    } finally {
        client.release();
    }
}

/**
 * Force-release a stale advisory lock by terminating the backend PID.
 * Only use this during crash recovery — it kills the PostgreSQL connection.
 */
async function forceReleaseLock(pid) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT pg_terminate_backend($1) AS terminated',
            [pid]
        );
        return result.rows[0].terminated;
    } finally {
        client.release();
    }
}

module.exports = {
    acquireLock,
    releaseLock,
    withLock,
    listActiveLocks,
    forceReleaseLock,
    getLockKey,
};
