const chalk = require('chalk');
const apiService = require('../services/api');
const configManager = require('../utils/config');

module.exports = async function branch(name, options) {
    configManager.ensureExists();
    const config = configManager.getConfig();
    const projectName = config.projectName;

    if (!name) {
        // List branches
        try {
            console.log(chalk.blue('📡 Fetching branches...'));
            const res = await apiService.getBranches(projectName);
            const branches = res.data.branches;
            const currentBranch = config.currentBranch || 'main';

            console.log(chalk.white('\nBranches:'));
            branches.forEach(b => {
                if (b.name === currentBranch) {
                    console.log(chalk.green(`* ${b.name}`));
                } else {
                    console.log(`  ${b.name}`);
                }
            });
        } catch (error) {
            console.error(chalk.red('✖ Failed to list branches.'));
            console.error(chalk.red(error.response?.data?.error || error.message));
        }
        return;
    }

    // Create branch
    try {
        console.log(chalk.blue(`🚀 Creating branch "${name}"...`));
        const res = await apiService.createBranch(projectName, name);
        if (res.data.success) {
            console.log(chalk.green(`\n✓ Branch "${name}" created successfully!`));
        }
    } catch (error) {
        console.error(chalk.red(`\n✖ Failed to create branch "${name}".`));
        console.error(chalk.red(error.response?.data?.error || error.message));
    }
};
