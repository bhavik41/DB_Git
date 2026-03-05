#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const figlet = require('figlet');

const initCommand = require('../commands/init');
const commitCommand = require('../commands/commit');
const logCommand = require('../commands/log');
const loginCommand = require('../commands/login');
const branchCommand = require('../commands/branch');
const checkoutCommand = require('../commands/checkout');
const checkUpdate = require('../utils/updater');

const program = new Command();

console.log(
    chalk.cyan(
        figlet.textSync('DB-Git', { horizontalLayout: 'full' })
    )
);

program
    .version('1.0.0')
    .description('Database Version Control System (CLI)');

program
    .command('init')
    .description('Initialize a new DB-Git repository')
    .argument('[name]', 'Project name')
    .option('-d, --database <url>', 'Target Database connection string')
    .option('-r, --remote <url>', 'DB-Git Remote Server URL')
    .action(initCommand);

program
    .command('commit')
    .description('Record changes to the repository')
    .option('-m, --message <msg>', 'Commit message')
    .action(commitCommand);

program
    .command('log')
    .description('Show commit logs')
    .action(logCommand);

program
    .command('remote')
    .description('Manage remote server connections')
    .option('--get-url', 'Show current remote URL')
    .option('--set-url <url>', 'Change remote URL')
    .action(require('../commands/remote'));

program
    .command('login')
    .description('Login with GitHub')
    .action(loginCommand);

program
    .command('branch [name]')
    .description('List or create branches')
    .action(branchCommand);

program
    .command('checkout <branch_name>')
    .description('Switch to a specific branch')
    .action(checkoutCommand);

program
    .command('rollback <commit_id>')
    .description('Rollback DB schema to a specific commit')
    .action(async (commitId) => {
        try {
            const configManager = require('../utils/config');
            configManager.ensureExists();
            const config = configManager.getConfig();

            const api = require('../services/api');
            await api.rollback(config.projectName, commitId);

            console.log(chalk.green('✔ Rollback successful'));
        } catch (error) {
            console.log(chalk.red('✖ Rollback failed'));
            console.error(error.message);
        }
    });

async function main() {
    await program.parseAsync(process.argv);

    if (!process.argv.slice(2).length) {
        program.outputHelp();
    }

    await checkUpdate();
}

main();
