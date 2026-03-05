const chalk = require('chalk');
const apiService = require('../services/api');
const configManager = require('../utils/config');

module.exports = async function checkout(name, options) {
    configManager.ensureExists();
    const config = configManager.getConfig();
    const projectName = config.projectName;

    if (!name) {
        console.error(chalk.red('Error: Please specify a branch name.'));
        return;
    }

    try {
        console.log(chalk.blue(`🚀 Checking out branch "${name}"...`));
        const res = await apiService.getBranches(projectName);
        const branches = res.data.branches;
        const targetBranch = branches.find(b => b.name === name);

        if (!targetBranch) {
            console.error(chalk.red(`Error: Branch "${name}" not found.`));
            return;
        }

        const newConfig = { ...config, currentBranch: name };
        configManager.saveConfig(newConfig);
        console.log(chalk.green(`\n✓ Switched to branch "${name}"`));

    } catch (error) {
        console.error(chalk.red(`\n✖ Checkout failed.`));
        console.error(chalk.red(error.response?.data?.error || error.message));
    }
};
