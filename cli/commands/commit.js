const inquirer = require('inquirer').default;
const chalk = require('chalk');
const configManager = require('../utils/config');
const apiService = require('../services/api');
const { getSchemaSnapshot } = require('../core/introspection');
const { execSync } = require('child_process');

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

        console.log(chalk.blue('📦 Capturing data snapshot via Docker...'));
        let dataDump = null;
        try {
            // For this demo, we assume the target is the docker container 
            // We extract the DB name from the URL
            const dbName = config.targetDbUrl.split('/').pop().split('?')[0];
            dataDump = execSync(`docker exec dbgit-postgres pg_dump -U postgres -d ${dbName} --clean --if-exists --inserts`, { encoding: 'utf8' });
            dataDump = dataDump.split('\n').filter(line => !line.trim().startsWith('\\')).join('\n');
        } catch (dumpError) {
            console.warn(chalk.yellow('⚠️  Warning: Data snapshot failed. Only schema will be preserved.'));
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
        const commitRes = await apiService.pushCommit(config.projectName, {
            message,
            snapshot: currentSnapshot,
            dataDump, // Include the full SQL dump
            diff: [], // Diff engine removed as per user request
            prevCommitId,
            branchName: 'main'
        });

        if (commitRes.data.success) {
            console.log(chalk.green(`\n✓ Commit [${commitRes.data.commitId.substring(0, 8)}] created successfully!`));
        }

    } catch (error) {
        console.error(chalk.red('\n✖ Commit failed.'));
        console.error(chalk.red(error.response?.data?.error || error.message));
    }
};
