const fs = require('fs');
const path = require('path');

function readEnvFile(envPath) {
  try {
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Parse KEY="VALUE" or KEY='VALUE' or KEY=VALUE
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#\s]+))?/);
      if (!match) continue;

      const key = match[1];
      const value = match[2] || match[3] || match[4] || '';
      env[key] = value;
    }

    return env;
  } catch {
    return {};
  }
}

function getProjectRoot() {
  return path.resolve(__dirname, '..', '..');
}

function getEnv(name, options = {}) {
  const v = process.env[name];
  if (v && String(v).trim()) return String(v).trim();

  const envPath = options.envPath || path.join(getProjectRoot(), '.env');
  const fileEnv = readEnvFile(envPath);
  if (fileEnv[name] && String(fileEnv[name]).trim()) return String(fileEnv[name]).trim();

  return '';
}

module.exports = {
  readEnvFile,
  getEnv,
};

