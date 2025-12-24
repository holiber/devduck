import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseDotenv } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface EnvOptions {
  envPath?: string;
}

function readEnvFile(envPath: string): Record<string, string> {
  try {
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    // Use dotenv.parse() to parse .env file without loading into process.env
    const parsed = parseDotenv(content);
    if (!parsed) return {};
    // Convert to Record<string, string> (dotenv returns Record<string, string | undefined>)
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined && value !== null) {
        env[key] = String(value);
      }
    }
    return env;
  } catch {
    return {};
  }
}

export function getProjectRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

export function getEnv(name: string, options: EnvOptions = {}): string {
  const v = process.env[name];
  if (v && String(v).trim()) return String(v).trim();

  const envPath = options.envPath || path.join(getProjectRoot(), '.env');
  const fileEnv = readEnvFile(envPath);
  if (fileEnv[name] && String(fileEnv[name]).trim()) return String(fileEnv[name]).trim();

  return '';
}

export { readEnvFile };

