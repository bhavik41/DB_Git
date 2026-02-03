const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

// ✅ Local config: project-specific settings (per repo folder)
const CONFIG_DIR = path.join(process.cwd(), '.dbv');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// ✅ Global config: user-level settings (token lives here, across all projects)
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.dbv');
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, 'config.json');

class ConfigManager {

    // --- Local (project-level) config ---

    getConfig() {
        if (!fs.existsSync(CONFIG_FILE)) return null;
        try {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        } catch (e) {
            return null;
        }
    }

    saveConfig(config) {
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }

    exists() {
        return fs.existsSync(CONFIG_FILE);
    }

    ensureExists() {
        if (!this.exists()) {
            console.error(chalk.red('Error: Not a DB-Git repository. Run "dbv init" first.'));
            process.exit(1);
        }
    }

    // --- Global (user-level) config — token is stored here ---

    getGlobalConfig() {
        if (!fs.existsSync(GLOBAL_CONFIG_FILE)) return null;
        try {
            return JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf8'));
        } catch (e) {
            return null;
        }
    }

    saveGlobalConfig(config) {
        if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
            fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
        }
        fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2));
    }
}

module.exports = new ConfigManager();