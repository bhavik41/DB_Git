const configManager = require('../utils/config');
const apiService = require('../services/api');
const chalk = require('chalk');
const { getSchemaSnapshot } = require('../core/introspection');
const { diffSchemas } = require('../core/diff');

module.exports = async function diff(commit1, commit2) {
    configManager.ensureExists();
    const config = configManager.getConfig();
    await apiService.init();

    try {
        let oldSchema, newSchema;

        // Base schema
        if (commit1) {
            console.log(chalk.blue(`📡 Fetching commit ${commit1}...`));
            const res = await apiService.getCommit(config.projectName, commit1);
            oldSchema = res.data.snapshot;
        } else {
            console.log(chalk.blue('📡 Fetching remote HEAD...'));
            const res = await apiService.getLatestCommit(config.projectName);
            oldSchema = res.data.commit ? res.data.commit.snapshot : { tables: {} };
        }

        // Target schema
        if (commit2) {
            console.log(chalk.blue(`📡 Fetching commit ${commit2}...`));
            const res = await apiService.getCommit(config.projectName, commit2);
            newSchema = res.data.snapshot;
        } else {
            console.log(chalk.blue('🔍 Introspecting live DB...'));
            newSchema = await getSchemaSnapshot(config.targetDbUrl);
        }

        const changes = diffSchemas(oldSchema, newSchema);

        if (changes.length === 0) {
            console.log(chalk.green('\nNo structural differences found.'));
            return;
        }

        console.log(chalk.yellow(`\nFound ${changes.length} structural differences:\n`));

        changes.forEach(c => {
            let icon = chalk.green('+');
            if (c.type.startsWith('DROP')) icon = chalk.red('-');
            if (c.type.startsWith('ALTER')) icon = chalk.blue('~');

            let details = '';
            if (c.type === 'ADD_TABLE') {
                const colNames = Object.keys(c.columns || {});
                details = chalk.dim(` with columns: [${colNames.join(', ')}]`);
            } else if (c.type === 'ADD_COLUMN') {
                details = chalk.dim(` (${c.details.type})`);
            } else if (c.type === 'ALTER_COLUMN') {
                details = c.modifications.map(m => {
                    return chalk.dim(` [${m.trait}: ${m.old} -> ${m.new}]`);
                }).join(', ');
            }

            console.log(`  ${icon} ${c.type.padEnd(15)} | ${chalk.bold(c.tableName)}${c.columnName ? '.' + c.columnName : ''}${details}`);
        });
        console.log('');

    } catch (error) {
        console.error(chalk.red('Error: Diff calculation failed.'));
        console.error(chalk.red(error.message));
    }
};
