import { readJSON } from '../lib/config.js';
import { readEnvFile } from '../lib/env.js';
import { print, symbols } from '../utils.js';

export function checkTokensOnly(params: {
  configFilePath: string;
  envFilePath: string;
  log: (message: string) => void;
}): void {
  const { configFilePath, envFilePath, log } = params;

  print(`\n${symbols.search} Checking required tokens...\n`, 'blue');

  const config = readJSON(configFilePath);
  if (!config) {
    print(`${symbols.error} Error: Cannot read ${configFilePath}`, 'red');
    process.exit(1);
  }

  if (!config.env || !Array.isArray(config.env) || config.env.length === 0) {
    print(`${symbols.info} No environment variables defined in config`, 'cyan');
    process.exit(0);
  }

  const env = readEnvFile(envFilePath);

  let allPresent = true;
  const missing: string[] = [];
  const present: string[] = [];

  print(`\n${symbols.info} Checking ${config.env.length} token(s)...\n`, 'cyan');

  for (const envVar of config.env) {
    const key = envVar && typeof envVar === 'object' ? (envVar as { name?: string }).name : null;
    const comment =
      envVar && typeof envVar === 'object' ? ((envVar as { description?: string }).description || '') : '';

    if (!key) {
      print(`  ${symbols.warning} Skipping invalid env entry (missing name)`, 'yellow');
      log(`Skipping invalid env entry: ${JSON.stringify(envVar)}`);
      continue;
    }

    const value = process.env[key] || env[key];
    if (value && value.trim() !== '') {
      print(`  ${symbols.success} ${key} - present`, 'green');
      present.push(key);
    } else {
      print(`  ${symbols.error} ${key} - missing${comment ? ` (${comment})` : ''}`, 'red');
      missing.push(key);
      allPresent = false;
    }
  }

  print(`\n${symbols.check} Token check completed!`, allPresent ? 'green' : 'yellow');
  print(`  Present: ${present.length}/${config.env.length}`, allPresent ? 'green' : 'yellow');

  if (missing.length > 0) {
    print(`  Missing: ${missing.join(', ')}`, 'red');
    print(`\n${symbols.info} Run 'node install.js' to set up missing tokens`, 'cyan');
  }

  process.exit(allPresent ? 0 : 1);
}


