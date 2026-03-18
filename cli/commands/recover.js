/**
 * Member 6 — CLI: dbv recover
 *
 * Commands:
 *   dbv recover                  → show status of all in-progress operations
 *   dbv recover --auto           → auto-clean all stale operations
 *   dbv recover --force <op-id>  → force-clean a specific operation by ID
 */

const chalk = require('chalk');
const apiService = require('../services/api');
const configManager = require('../utils/config');

module.exports = async function recover(options) {
    await apiService.init();

    try {
        // ── Fetch recovery status from server ─────────────────────────────────
        const res = await apiService.client.get('/api/recovery/status');
        const { inProgressOps, staleOpsCount, activeAdvisoryLocks, recentFailures } = res.data;

        // ── Force-clean a specific op ──────────────────────────────────────────
        if (options.force) {
            const opId = options.force;
            console.log(chalk.yellow(`\n⚡ Force-cleaning operation: ${opId}`));
            const cleanRes = await apiService.client.post('/api/recovery/force-clean', { opId });
            const cleaned = cleanRes.data.cleaned;
            console.log(chalk.green(`✅ Cleaned: ${cleaned.projectName}:${cleaned.branchName} (author: ${cleaned.author})`));
            return;
        }

        // ── Display status ─────────────────────────────────────────────────────
        console.log(chalk.bold('\n🔧 DB-Git Recovery Status\n'));
        console.log(chalk.gray('─'.repeat(60)));

        // In-progress operations
        if (inProgressOps.length === 0) {
            console.log(chalk.green('✅ No operations currently in progress.'));
        } else {
            console.log(chalk.bold(`📋 In-Progress Operations (${inProgressOps.length}):\n`));
            inProgressOps.forEach(op => {
                const statusIcon = op.isStale ? chalk.red('⚠  STALE') : chalk.green('✓  LIVE');
                const aliveStatus = op.isProcessAlive
                    ? chalk.green('process alive')
                    : chalk.red('process dead');

                console.log(`  ${statusIcon}  ${chalk.bold(op.projectName)}:${op.branchName}`);
                console.log(`     Author   : ${op.author}`);
                console.log(`     PID      : ${op.pid} (${aliveStatus})`);
                console.log(`     Age      : ${op.ageSeconds}s`);
                console.log(`     Op ID    : ${op.id}`);
                console.log();
            });
        }

        // Advisory locks summary
        console.log(chalk.gray('─'.repeat(60)));
        console.log(`🔒 Active Advisory Locks : ${activeAdvisoryLocks}`);
        console.log(`⚠  Stale Operations     : ${staleOpsCount}`);

        // Recent failures
        if (recentFailures.length > 0) {
            console.log(chalk.gray('\n' + '─'.repeat(60)));
            console.log(chalk.bold(`\n💥 Recent Failures (last ${recentFailures.length}):\n`));
            recentFailures.slice(0, 5).forEach(f => {
                const time = new Date(f.occurredAt).toLocaleString();
                console.log(`  ${chalk.red('✖')} [${time}] ${f.operation} on ${f.projectName}`);
                console.log(`     Error: ${chalk.gray(f.error)}`);
                console.log();
            });

            if (recentFailures.length > 5) {
                console.log(chalk.gray(`  ... and ${recentFailures.length - 5} more`));
            }
        } else {
            console.log(chalk.green('\n✅ No recent failures recorded.'));
        }

        // ── Auto-clean stale ops ───────────────────────────────────────────────
        if (options.auto && staleOpsCount > 0) {
            console.log(chalk.yellow(`\n🧹 Auto-cleaning ${staleOpsCount} stale operation(s)...`));
            const staleOps = inProgressOps.filter(op => op.isStale);
            for (const op of staleOps) {
                try {
                    await apiService.client.post('/api/recovery/force-clean', { opId: op.id });
                    console.log(chalk.green(`  ✅ Cleaned: ${op.projectName}:${op.branchName} (${op.id.substring(0, 8)})`));
                } catch (err) {
                    console.log(chalk.red(`  ✖ Failed to clean ${op.id.substring(0, 8)}: ${err.message}`));
                }
            }
        } else if (staleOpsCount > 0) {
            console.log(chalk.yellow(
                `\n💡 ${staleOpsCount} stale operation(s) found. ` +
                `Run ${chalk.bold('dbv recover --auto')} to clean them up.\n` +
                `Or force-clean a specific one: ${chalk.bold('dbv recover --force <op-id>')}`
            ));
        }

        console.log(chalk.gray('\n─'.repeat(60)));

    } catch (error) {
        console.error(chalk.red('\n✖ Recovery check failed.'));
        console.error(chalk.red(error.response?.data?.error || error.message));
    }
};
