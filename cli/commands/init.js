const inquirer = require('inquirer').default;
const chalk = require('chalk');
const configManager = require('../utils/config');
const apiService = require('../services/api');

module.exports = async function init(name, options) {
    console.log(chalk.cyan('-------------------------------------------'));
    console.log(chalk.cyan('   Initializing DB-Git Repository...'));
    console.log(chalk.cyan('-------------------------------------------'));

    if (configManager.exists()) {
        const { overwrite } = await inquirer.prompt([{
            type: 'confirm',
            name: 'overwrite',
            message: 'A DB-Git repository already exists here. Overwrite?',
            default: false
        }]);
        if (!overwrite) return;
    }

    const questions = [];

    if (!name) {
        questions.push({
            type: 'input',
            name: 'projectName',
            message: 'Project Name:',
            validate: (val) => val.length > 0
        });
    }

    if (!options.database) {
        questions.push({
            type: 'input',
            name: 'targetDbUrl',
            message: 'Target DB URL (postgres://...):',
            default: 'postgresql://postgres:postgres@localhost:5432/my_database'
        });
    }

    const answers = questions.length > 0 ? await inquirer.prompt(questions) : {};

    const projectName = name || answers.projectName;
    const targetDbUrl = options.database || answers.targetDbUrl;
    const apiUrl = options.remote || 'http://localhost:3000';

    const globalConfig = configManager.getGlobalConfig();
    if (!globalConfig || !globalConfig.token) {
        console.error(chalk.red('\n✖ You are not logged in. Please run "dbv login" first.'));
        process.exit(1);
    }

    try {
        await apiService.init(apiUrl);
        console.log(chalk.yellow(`Connecting to remote server at ${apiUrl}...`));

        const response = await apiService.createProject(projectName, 'Initialized via CLI', targetDbUrl);  // ✅ pass targetDbUrl

        if (response.data.success) {
            configManager.saveConfig({
                projectName,
                targetDbUrl,
                apiUrl,
                remoteOrigin: apiUrl
            });
            console.log(chalk.green('\n✔ Project successfully initialized and linked to remote!'));
        }
    } catch (error) {
        console.error(chalk.red('\n✖ Initialization failed.'));
        console.error(chalk.red(`Error: ${error.message}`));
        if (error.code === 'ECONNREFUSED') {
            console.log(chalk.yellow('Hint: Is the backend server running?'));
        }
        if (error.response?.status === 401) {
            console.log(chalk.yellow('Hint: Your session may have expired. Run "dbv login" again.'));
        }
    }
};