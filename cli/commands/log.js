const configManager = require('../utils/config');
const apiService = require('../services/api');
const chalk = require('chalk');
const { table } = require('table');

module.exports = async function log() {
    configManager.ensureExists();
    const config = configManager.getConfig();
    await apiService.init();

    try {
        const response = await apiService.getLog(config.projectName);
        const commits = response.data.commits;

        if (commits.length === 0) {
            console.log(chalk.yellow('No history found for this project.'));
            return;
        }

        console.log(chalk.cyan(`\nHistory for project: ${config.projectName}\n`));

        const data = [[
            chalk.bold('Date'),
            chalk.bold('ID'),
            chalk.bold('Author'),
            chalk.bold('Message')
        ]];

        commits.forEach(c => {
            data.push([
                new Date(c.createdAt).toLocaleString(),
                c.id.substring(0, 8),
                c.author,
                c.message
            ]);
        });

        console.log(table(data));

    } catch (error) {
        console.error(chalk.red('Error: Couldn\'t fetch log.'));
        console.error(chalk.red(error.response?.data?.error || error.message));
    }
};
