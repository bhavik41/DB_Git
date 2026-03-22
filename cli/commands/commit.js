/**
 * CLI: dbv commit — Member 6 updated version
 *
 * Changes from original:
 *   - Added retry logic for 409 Conflict (lock contention / branch diverged)
 *   - Clear error messages distinguish lock contention from branch divergence
 *   - Retries up to MAX_RETRIES times with exponential backoff for lock conflicts
 */

const inquirer = require('inquirer').default;
const chalk = require('chalk');
const configManager = require('../utils/config');
const apiService = require('../services/api');
const { getSchemaSnapshot } = require('../core/introspection');
const { execSync } = require('child_process');

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

module.exports = async function commit(options) {
    configManager.ensureExists();
    const config = configManager.getConfig();
    await apiService.init();

    try {
        console.log(chalk.blue('🔍 Introspecting target database...'));
        const currentSnapshot = await getSchemaSnapshot(config.targetDbUrl);

        console.log(chalk.blue('📡 Fetching remote state...'));
        const latestRes = await apiService.getLatestCommit(config.projectName);
        const prevCommitId = latestRes.data.commit ? latestRes.data.commit.id : null;

        console.log(chalk.blue('📦 Capturing data snapshot via local pg_dump...'));
        let dataDump = null;
        try {
            /** 
             * Member 7 Update: Remove Docker dependency.
             * Use local pg_dump with the target configuration URL.
             */
            const dbUrl = config.targetDbUrl;

            // Execute pg_dump directly using the connection string.
            // --clean --if-exists: helps restoration idempotency
            // --inserts: preferred for cross-version compatibility within our JSON storage
            dataDump = execSync(`pg_dump "${dbUrl}" --clean --if-exists --inserts`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'] // avoid leaking password prompts to stdout
            });

            // Post-processing: remove comments and certain system lines
            dataDump = dataDump.split('\n')
                .filter(line => !line.trim().startsWith('--') && !line.trim().startsWith('\\') && line.trim().length > 0)
                .join('\n');

        } catch (dumpError) {
            console.warn(chalk.yellow('⚠️  Warning: Local data snapshot failed. Only schema will be preserved.'));
            console.warn(chalk.dim('Make sure "pg_dump" is installed and in your PATH.'));
            console.warn(chalk.dim(dumpError.message));
        }

        let message = options.message;
        if (!message) {
            const answers = await inquirer.prompt([{
                type: 'input',
                name: 'message',
                message: '\nCommit message:',
                validate: (v) => v.length > 0
            }]);
            message = answers.message;
        }

        console.log(chalk.blue('\n🚀 Pushing snapshot to remote...'));
        console.log(chalk.dim(`  - Data dump size: ${dataDump ? dataDump.length : 0} bytes`));


        // ── Retry loop for lock contention (Member 6) ─────────────────────────
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const commitRes = await apiService.pushCommit(config.projectName, {
                    message,
                    snapshot: currentSnapshot,
                    dataDump,
                    diff: [],
                    prevCommitId,
                    branchName: config.currentBranch || 'main'
                });

                if (commitRes.data.success) {
                    console.log(chalk.green(
                        `\n✓ Commit [${commitRes.data.commitId.substring(0, 8)}] created successfully!`
                    ));
                    return; // success — exit
                }

            } catch (error) {
                const statusCode = error.response?.status;
                const serverMsg = error.response?.data?.error || error.message;

                // 409: either lock contention OR branch divergence
                if (statusCode === 409) {

                    // Branch diverged — this is NOT retryable (user needs to pull)
                    if (serverMsg.includes('diverged') || serverMsg.includes('head moved')) {
                        console.error(chalk.red('\n✖ Commit rejected: branch has diverged.'));
                        console.error(chalk.yellow(
                            '  Another commit was pushed to this branch since you last fetched.\n' +
                            '  Run `dbv log` to see the latest state, then retry.'
                        ));
                        return;
                    }

                    // Lock contention — retry with backoff
                    if (attempt < MAX_RETRIES) {
                        const delay = RETRY_BASE_DELAY_MS * attempt;
                        console.log(chalk.yellow(
                            `\n⏳ Branch is locked by another operation. ` +
                            `Retrying in ${delay / 1000}s... (attempt ${attempt}/${MAX_RETRIES})`
                        ));
                        await sleep(delay);
                        lastError = error;
                        continue;
                    }

                    lastError = error;
                    break;
                }

                // Non-retryable error
                throw error;
            }
        }

        // All retries exhausted
        if (lastError) {
            const serverMsg = lastError.response?.data?.detail || lastError.response?.data?.error || lastError.message;
            console.error(chalk.red(`\n✖ Commit failed after ${MAX_RETRIES} attempts.`));
            console.error(chalk.red(serverMsg));
            console.error(chalk.yellow(
                '  The branch is still locked by another active operation.\n' +
                '  Run `dbv recover` to check for stale locks.'
            ));
        }

    } catch (error) {
        console.error(chalk.red('\n✖ Commit failed.'));
        console.error(chalk.red(error.response?.data?.error || error.message));
    }
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
