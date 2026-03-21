/**
 * Member 6 — Concurrency Control: Express Middleware
 *
 * Wraps commit and rollback routes with advisory lock acquisition.
 * Attaches lock context to req so controllers can release it properly.
 *
 * Usage in routes:
 *   const { commitLock, rollbackLock } = require('../middleware/concurrency');
 *   router.post('/:projectName/commits', commitLock, commitController);
 *   router.post('/:projectName/rollback', rollbackLock, rollbackController);
 */

const { acquireLock, releaseLock } = require('../services/lockService');
const { logFailure } = require('../services/transactionService');

/**
 * Generic lock middleware factory.
 * Acquires advisory lock, attaches release fn to res.locals, auto-releases on finish.
 */
function createLockMiddleware(getBranchName) {
    return async function lockMiddleware(req, res, next) {
        // BUG FIX: req.body can be undefined for routes that send no body (e.g. rollback).
        // Defaulting to {} prevents "Cannot read properties of undefined" crashes.
        const body = req.body || {};

        const projectName = req.params.name || req.params.projectName || body.projectName;
        const branchName = getBranchName(req) || 'main';

        if (!projectName) {
            return res.status(400).json({ error: 'projectName is required' });
        }

        const { acquired, client, lockKey } = await acquireLock(projectName, branchName);

        if (!acquired) {
            return res.status(409).json({
                error: `Concurrent operation in progress`,
                detail: `Another commit or rollback is already running on ` +
                        `"${projectName}:${branchName}". Please retry in a moment.`,
                retryAfterMs: 2000,
            });
        }

        // Attach release function so it works even if controller throws
        let released = false;
        const release = async () => {
            if (!released) {
                released = true;
                await releaseLock(client, lockKey);
            }
        };

        // Auto-release when response finishes (covers success, errors, and crashes)
        res.on('finish', release);
        res.on('close', release);  // client disconnected early

        // Also expose for manual release in controllers if needed
        res.locals.releaseLock = release;
        res.locals.lockProjectName = projectName;
        res.locals.lockBranchName = branchName;

        next();
    };
}

/**
 * Middleware for commit endpoint.
 * Branch comes from request body (CLI sends branchName in JSON).
 */
const commitLock = createLockMiddleware((req) => (req.body || {}).branchName);

/**
 * Middleware for rollback endpoint.
 * Branch is resolved inside the service, so we default to 'main' here.
 * The lock still prevents overlapping rollbacks on the project.
 */
const rollbackLock = createLockMiddleware((req) => (req.body || {}).branchName || 'main');

/**
 * Error-catching wrapper for controller functions.
 * Ensures the advisory lock is released even if the controller throws
 * an unhandled exception (guards against missing try/catch).
 *
 * Usage:
 *   router.post('/:projectName/commits', commitLock, safeHandler(controller.createCommit));
 */
function safeHandler(controllerFn) {
    return async (req, res, next) => {
        try {
            await controllerFn(req, res, next);
        } catch (err) {
            // Log to FailureLog table
            const projectName = res.locals.lockProjectName;
            const branchName = res.locals.lockBranchName;
            const author = req.user?.username || 'unknown';

            await logFailure('handler_crash', projectName, branchName, author, err, {
                method: req.method,
                path: req.path,
                body: JSON.stringify(req.body || {}).substring(0, 500),
            }).catch(() => {}); // never let logging crash the error handler

            next(err);
        }
    };
}

module.exports = {
    commitLock,
    rollbackLock,
    safeHandler,
};