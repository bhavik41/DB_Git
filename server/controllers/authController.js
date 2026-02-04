const axios = require('axios');
const jwt = require('jsonwebtoken');
const prisma = require('../configs/db');

class AuthController {
    async githubAuth(req, res) {
        const client_id = process.env.GITHUB_CLIENT_ID;
        if (!client_id || client_id === 'YOUR_CLIENT_ID_HERE') {
            return res.status(500).send('GITHUB_CLIENT_ID is not configured on the server.');
        }

        const { port } = req.query;
        const state = port ? Buffer.from(JSON.stringify({ port })).toString('base64') : '';

        const redirect_uri = `${req.protocol}://${req.get('host')}/auth/github/callback`;
        const url = `https://github.com/login/oauth/authorize?client_id=${client_id}&redirect_uri=${redirect_uri}&scope=user:email&state=${state}`;

        console.log(`[AUTH] Redirecting to GitHub: ${url}`);
        res.redirect(url);
    }

    async githubCallback(req, res) {
        const { code, state } = req.query;
        const client_id = process.env.GITHUB_CLIENT_ID;
        const client_secret = process.env.GITHUB_CLIENT_SECRET;

        if (!code) {
            return res.status(400).send('No code provided from GitHub.');
        }

        if (!client_secret || client_secret === 'REPLACE_THIS_WITH_YOUR_SECRET') {
            return res.status(500).send('GITHUB_CLIENT_SECRET is missing in server environment. Cannot exchange code for token.');
        }

        try {
            // 1. Exchange code for GitHub access token
            const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
                client_id,
                client_secret,
                code
            }, {
                headers: { Accept: 'application/json' }
            });

            if (tokenRes.data.error) {
                return res.status(400).send(`GitHub Error: ${tokenRes.data.error_description}`);
            }

            const github_token = tokenRes.data.access_token;

            // 2. Get User Profile
            const userResponse = await axios.get('https://api.github.com/user', {
                headers: { Authorization: `Bearer ${github_token}` }
            });

            // 3. Get Email
            const emailResponse = await axios.get('https://api.github.com/user/emails', {
                headers: { Authorization: `Bearer ${github_token}` }
            });
            const primaryEmail = emailResponse.data.find(e => e.primary && e.verified)?.email || emailResponse.data[0]?.email;

            const { login, id } = userResponse.data;

            // 4. Upsert User
            const user = await prisma.user.upsert({
                where: { githubId: id.toString() },
                update: { username: login, email: primaryEmail },
                create: { githubId: id.toString(), username: login, email: primaryEmail }
            });

            // 5. Generate JWT
            const token = jwt.sign(
                { userId: user.id, username: user.username, email: user.email },
                process.env.JWT_SECRET || 'bhavik-db-git-security-token-2024',
                { expiresIn: '30d' }
            );

            // 6. Redirect back to CLI
            if (state) {
                try {
                    const { port } = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
                    if (port) {
                        return res.redirect(`http://localhost:${port}/callback?token=${token}&username=${login}`);
                    }
                } catch (e) {
                    console.error('Failed to parse state:', e);
                }
            }

            // Fallback if no CLI port
            res.send(`
                <h1>Login Successful</h1>
                <p>You can close this window. Your token is: <code>${token}</code></p>
            `);

        } catch (error) {
            console.error('[AUTH] Callback Error:', error.message);
            res.status(500).send('Authentication failed.');
        }
    }

    // Keep existing exchange method for backward or alternative compatibility
    async exchange(req, res) {
        const { github_token } = req.body;
        if (!github_token) return res.status(400).json({ error: 'github_token is required' });

        try {
            const userResponse = await axios.get('https://api.github.com/user', {
                headers: { Authorization: `Bearer ${github_token}` }
            });

            const emailResponse = await axios.get('https://api.github.com/user/emails', {
                headers: { Authorization: `Bearer ${github_token}` }
            });

            const primaryEmail = emailResponse.data.find(e => e.primary && e.verified)?.email || emailResponse.data[0]?.email;
            const { login, id } = userResponse.data;

            // 4. Smart/Robust User Update/Create
            let user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { githubId: id.toString() },
                        { email: primaryEmail }
                    ]
                }
            });

            if (user) {
                // Update existing user
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        githubId: id.toString(),
                        username: login,
                        email: primaryEmail
                    }
                });
            } else {
                // Create new user
                user = await prisma.user.create({
                    data: {
                        githubId: id.toString(),
                        username: login,
                        email: primaryEmail
                    }
                });
            }

            // 5. Generate JWT
            const token = jwt.sign(
                { userId: user.id, username: user.username, email: user.email },
                process.env.JWT_SECRET || 'bhavik-db-git-security-token-2024',
                { expiresIn: '30d' }
            );

            console.log(`[AUTH] Exchange successful for user: ${login}`);
            res.json({ success: true, token });
        } catch (error) {
            console.error('Exchange Error:', error.message);
            if (error.response) {
                console.error('GitHub API Error Status:', error.response.status);
                console.error('GitHub API Error Data:', JSON.stringify(error.response.data, null, 2));
            }
            // More descriptive error for the client
            res.status(500).json({
                error: 'Token exchange failed',
                message: error.message,
                details: error.response?.data
            });
        }
    }
}

module.exports = new AuthController();
