require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression');
const jwt = require('jsonwebtoken');

const projectRoutes = require('./routes/projectRoutes');
const authRoutes = require('./routes/authRoutes');
const recoveryRoutes = require('./routes/recoveryRoutes');           // Member 6
const { runStartupRecovery } = require('./services/recoveryService'); // Member 6

const app = express();

app.use(compression());
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Auth Routes
app.use('/auth', authRoutes);

// Auth Middleware
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required. Run "dbv login" first.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token. Run "dbv login" again.' });
    }
};

// Apply Auth to Projects
app.use('/projects', authenticate, projectRoutes);

// Member 6: Recovery routes
app.use('/api/recovery', authenticate, recoveryRoutes);

// Health Check
app.get('/health', (req, res) => res.json({ status: 'up' }));

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${err.stack}`);
    res.status(500).json({
        error: 'Internal Server Error',
        message: err.message
    });
});

// Member 6: Run crash recovery scan on startup
setImmediate(() => {
    runStartupRecovery().catch(err => {
        console.error('[App] Startup recovery failed:', err.message);
    });
});

module.exports = app;