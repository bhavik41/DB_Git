const inquirer = require('inquirer').default;
const chalk = require('chalk');
const configManager = require('../utils/config');
const apiService = require('../services/api');
const commitCommand = require('./commit');
const { getSchemaSnapshot } = require('../core/introspection');
const { diffSchemas } = require('../core/diff');

module.exports = async function rollback(commitId, options = {}) {
    configManager.ensureExists();
    const config = configManager.getConfig();
    await apiService.init();

    const force = options.force || false;

    try {
        console.log(chalk.blue('🔍 Checking for uncommitted changes...'));

        // 1. Get current live schema snapshot
        const currentSchema = await getSchemaSnapshot(config.targetDbUrl);

        // 2. Get latest commit from remote to compare
        const latestRes = await apiService.getLatestCommit(config.projectName);
        const latestCommit = latestRes.data.commit;

        let hasChanges = false;
        if (latestCommit && latestCommit.snapshot) {
            const changes = diffSchemas(latestCommit.snapshot, currentSchema);
            if (changes.length > 0) {
                hasChanges = true;
            }
        }

        // 3. User interaction if changes exist
        if (hasChanges && !force) {
            console.log(chalk.yellow('\n⚠️  UNCOMMITTED CHANGES DETECTED:'));
            console.log(chalk.dim('   Your live database has changes that are not saved in any commit.'));

            const answers = await inquirer.prompt([{
                type: 'list',
                name: 'action',
                message: 'How would you like to proceed before rolling back?',
                choices: [
                    { name: '💾 Save changes first (Commit)', value: 'commit' },
                    { name: '🗑️  Discard changes and rollback (Lose current data)', value: 'rollback' },
                    { name: '❌ Cancel rollback', value: 'cancel' }
                ]
            }]);

            if (answers.action === 'cancel') {
                console.log(chalk.gray('Rollback cancelled.'));
                return;
            }

            if (answers.action === 'commit') {
                console.log(chalk.blue('\n🚀 Saving current state before rollback...'));
                await commitCommand({ message: `Auto-save: state before rollback to ${commitId}` });
                console.log(chalk.green('✓ State saved.'));
            } else {
                console.log(chalk.red('\n🛑 WARNING: Current uncommitted data and schema changes will BE LOST.'));
                const confirm = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'proceed',
                    message: 'Are you absolutely sure you want to discard current changes?',
                    default: false
                }]);
                if (!confirm.proceed) return;
            }
        } else if (hasChanges && force) {
            console.log(chalk.yellow('\n⚠️  UNCOMMITTED CHANGES DETECTED (Forcing rollback — current work will be lost)'));
        }

        // 4. Fetch target commit to show warning about data snapshot existence
        console.log(chalk.blue(`📡 Fetching target commit [${commitId}] status...`));
        try {
            const res = await apiService.getCommit(config.projectName, commitId);
            const target = res.data;

            if (target) {
                console.log(chalk.white(`\nRestoring to: [${chalk.cyan(target.id.substring(0, 8))}] ${target.message}`));
                if (!target.dataDump) {
                    console.log(chalk.red('⚠️  WARNING: Target commit has NO data snapshot. Tables will be EMPTY after rollback.'));
                } else {
                    console.log(chalk.green('✅ Data snapshot found. Records will be restored.'));
                }
            }
        } catch (e) {
            console.warn(chalk.yellow('Could not verify target commit data status. Proceeding...'));
        }

        // 5. Final Rollback Execution
        console.log(chalk.red('\n🚨 ATTEMPTING ROLLBACK...'));
        if (!force) {
            const finalConfirm = await inquirer.prompt([{
                type: 'confirm',
                name: 'ok',
                message: chalk.bold('This operation drops and recreates tables. Final confirmation?'),
                default: false
            }]);

            if (!finalConfirm.ok) {
                console.log('Rollback cancelled.');
                return;
            }
        }

        const rollbackRes = await apiService.rollback(config.projectName, commitId);

        if (rollbackRes.data && (rollbackRes.data.id || rollbackRes.data.success)) {
            console.log(chalk.green(`\n✓ Rollback completed successfully!`));
        } else {
            console.log(chalk.yellow('\n⚠️ Rollback request finished, but no ID returned from server.'));
            console.log(chalk.dim(JSON.stringify(rollbackRes.data)));
        }

    } catch (error) {
        console.error(chalk.red('\n✖ Rollback operation failed.'));
        console.error(chalk.red(error.response?.data?.error || error.message));
    }
};
