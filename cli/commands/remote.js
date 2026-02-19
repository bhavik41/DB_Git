const configManager = require('../utils/config');
const chalk = require('chalk');

module.exports = async function remote(options) {
    configManager.ensureExists();
    const config = configManager.getConfig();

    if (options.getUrl) {
        console.log(chalk.cyan(`Remote Origin: ${config.remoteOrigin || config.apiUrl}`));
        return;
    }

    if (options.setUrl) {
        const newUrl = options.setUrl;
        config.apiUrl = newUrl;
        config.remoteOrigin = newUrl;
        configManager.saveConfig(config);
        console.log(chalk.green(`✓ Remote URL updated to: ${newUrl}`));
        return;
    }

    // Default: Show all relevant remote info
    console.log(chalk.bold('\nRemote Configurations:'));
    console.log(`  Project: ${chalk.yellow(config.projectName)}`);
    console.log(`  Remote:  ${chalk.cyan(config.remoteOrigin || config.apiUrl)}`);
    console.log(`  Target:  ${chalk.dim(config.targetDbUrl)}\n`);
};
