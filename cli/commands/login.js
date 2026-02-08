const axios = require('axios');
const chalk = require('chalk');
const configManager = require('../utils/config');
const apiService = require('../services/api');

const CLIENT_ID = '178c6fc778ccc68e1d6a';

module.exports = async function login() {
    console.log(chalk.cyan('\nStarting GitHub Device Authentication...'));
    console.log(chalk.gray('(This method works securely without requiring server secrets)\n'));

    try {
        let deviceRes;
        try {
            deviceRes = await axios.post('https://github.com/login/device/code', {
                client_id: CLIENT_ID,
                scope: 'user:email'
            }, {
                headers: { Accept: 'application/json' }
            });
        } catch (initialErr) {
            if (initialErr.response && initialErr.response.status === 404) {
                console.error(chalk.red('\n✖ Error: GitHub "Device Flow" is not enabled for this App.'));
                console.error(chalk.yellow('\nTo fix this:'));
                console.error(chalk.yellow('1. Go to your GitHub App settings (Developer Settings -> OAuth Apps).'));
                console.error(chalk.yellow('2. Select your App.'));
                console.error(chalk.yellow('3. Check the box "Enable Device Flow".'));
                console.error(chalk.yellow('4. Click "Update Application".\n'));
                process.exit(1);
            }
            throw initialErr;
        }

        const { device_code, user_code, verification_uri, interval, expires_in } = deviceRes.data;

        console.log(`1. Your Activation Code is: ${chalk.bold.green(user_code)}`);
        console.log(`2. Opening browser to: ${chalk.underline(verification_uri)}`);

        try {
            const { default: openLink } = await import('open');
            await openLink(verification_uri);
        } catch (err) {
            console.log(chalk.yellow(`   (Could not open browser automatically. Please visit the link above)`));
        }

        console.log(`\n${chalk.yellow('Waiting for authorization...')}`);

        let token = null;
        const startTime = Date.now();
        const pollInterval = (interval || 5) * 1000;

        while (!token) {
            if (Date.now() - startTime > expires_in * 1000) {
                console.error(chalk.red('\nLogin timed out. Please try again.'));
                return;
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));

            try {
                const pollRes = await axios.post('https://github.com/login/oauth/access_token', {
                    client_id: CLIENT_ID,
                    device_code: device_code,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                }, {
                    headers: { Accept: 'application/json' }
                });

                if (pollRes.data.access_token) {
                    token = pollRes.data.access_token;
                } else if (pollRes.data.error === 'authorization_pending') {
                    // Continue polling
                } else if (pollRes.data.error === 'slow_down') {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    throw new Error(pollRes.data.error_description || pollRes.data.error);
                }
            } catch (pollErr) {
                if (pollErr.response?.data?.error !== 'authorization_pending') {
                    throw pollErr;
                }
            }
        }

        console.log(chalk.blue('\n📡  Verifying with remote server...'));

        await apiService.init();
        const baseURL = apiService.client.defaults.baseURL || 'http://localhost:3000';

        const serverRes = await axios.post(`${baseURL}/auth/exchange`, {
            github_token: token
        });

        const jwt = serverRes.data.token;

        // ✅ Save token to GLOBAL config so it's available across all projects
        const currentGlobalConfig = configManager.getGlobalConfig() || {};
        configManager.saveGlobalConfig({
            ...currentGlobalConfig,
            token: jwt
        });

        console.log(chalk.green('\n✓ Successfully logged in! Your identity is now verified. 🚀\n'));

    } catch (error) {
        console.error(chalk.red('\nLogin failed.'));
        console.error(chalk.red(error.message));
        if (error.response?.data) {
            console.error(chalk.red(JSON.stringify(error.response.data, null, 2)));
        }
        process.exit(1);
    }
};