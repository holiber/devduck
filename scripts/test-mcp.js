#!/usr/bin/env node

/**
 * Universal MCP connectivity test for this repo.
 *
 * Reads `.cursor/mcp.json` and verifies that selected MCP server(s) respond to `tools/list`.
 *
 * Usage:
 *   node scripts/test-mcp.js                 # test all MCPs in .cursor/mcp.json
 *   node scripts/test-mcp.js intrasearch-mcp # test one MCP
 *   node scripts/test-mcp.js a b c           # test multiple MCPs
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { print, symbols } = require('./utils');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MCP_FILE = path.join(PROJECT_ROOT, '.cursor', 'mcp.json');

// Timeouts in milliseconds
const DEFAULT_TIMEOUT = 25000;

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function expandHome(p) {
  if (typeof p !== 'string') return p;
  return p.replace(/^~/, process.env.HOME || '');
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) return [];
  return args.map(a => expandHome(a));
}

function normalizeEnv(extraEnv) {
  if (!extraEnv || typeof extraEnv !== 'object') return process.env;
  const env = { ...process.env };
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined || v === null) continue;
    env[k] = String(v);
  }
  return env;
}

function buildInitializeMessages(clientName) {
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: clientName, version: '1.0' }
    }
  };
  const initNotification = { jsonrpc: '2.0', method: 'notifications/initialized' };
  const listTools = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
  return [initRequest, initNotification, listTools];
}

function stdioToolsList({ name, command, args, env, timeoutMs }) {
  return new Promise((resolve) => {
    const cmd = expandHome(command);
    const proc = spawn(cmd, normalizeArgs(args), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: normalizeEnv(env)
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      proc.kill('SIGTERM');
      resolve({ ok: false, error: 'Timeout waiting for tools/list response', stdout, stderr });
    }, timeoutMs);

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      const lines = stdout.split('\n');
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t);
          if (obj && obj.id === 2) {
            clearTimeout(timeout);
            if (!done) {
              done = true;
              proc.kill('SIGTERM');
              const tools = obj?.result?.tools;
              if (Array.isArray(tools)) {
                resolve({ ok: true, toolsCount: tools.length, stdout, stderr });
              } else {
                resolve({ ok: false, error: 'tools/list response has no tools[]', stdout, stderr });
              }
            }
          }
        } catch {
          // ignore partial lines
        }
      }
    });

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      if (!done) {
        done = true;
        resolve({ ok: false, error: err.message, stdout, stderr });
      }
    });

    proc.on('close', (code) => {
      if (done) return;
      clearTimeout(timeout);
      done = true;
      resolve({ ok: false, error: `Process exited early with code ${code}`, stdout, stderr });
    });

    // Send initialize + listTools
    const messages = buildInitializeMessages(`test-mcp:${name}`);
    for (const msg of messages) {
      proc.stdin.write(JSON.stringify(msg) + '\n');
    }
    proc.stdin.end();
  });
}

async function testOneMcp(name, cfg) {
  // Prefer stdio tools/list for command-based MCPs.
  if (cfg.command) {
    const result = await stdioToolsList({
      name,
      command: cfg.command,
      args: cfg.args || [],
      env: cfg.env || {},
      timeoutMs: DEFAULT_TIMEOUT
    });

    if (result.ok) {
      print(`${symbols.check} ${name}: OK (tools: ${result.toolsCount})`, 'green');
      return true;
    }

    print(`${symbols.error} ${name}: FAILED (${result.error})`, 'red');
    if (result.stderr && result.stderr.trim()) {
      print(`  stderr: ${result.stderr.trim().split('\n').slice(0, 3).join(' | ')}`, 'yellow');
    }
    return false;
  }

  // URL-only MCPs: we cannot do stdio MCP handshake here.
  // Treat as unsupported for tools/list and return failure (or allow optional).
  if (cfg.url) {
    const optional = cfg.optional === true;
    const msg = 'URL-based MCP: tools/list via stdio is not supported by this tester';
    if (optional) {
      print(`${symbols.warning} ${name}: SKIPPED (${msg})`, 'yellow');
      return true;
    }
    print(`${symbols.error} ${name}: FAILED (${msg})`, 'red');
    return false;
  }

  print(`${symbols.error} ${name}: FAILED (unknown MCP config: no command/url)`, 'red');
  return false;
}

async function main() {
  const argv = process.argv.slice(2).filter(a => a && !a.startsWith('-'));

  const cfg = readJson(MCP_FILE);
  if (!cfg || !cfg.mcpServers || typeof cfg.mcpServers !== 'object') {
    print(`${symbols.error} Cannot read MCP config at ${MCP_FILE}`, 'red');
    process.exit(1);
  }

  const allNames = Object.keys(cfg.mcpServers);
  const names = argv.length ? argv : allNames;

  let ok = true;
  for (const name of names) {
    const serverCfg = cfg.mcpServers[name];
    if (!serverCfg) {
      print(`${symbols.error} ${name}: not found in .cursor/mcp.json`, 'red');
      ok = false;
      continue;
    }
    const oneOk = await testOneMcp(name, serverCfg);
    if (!oneOk) ok = false;
  }

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  print(`${symbols.error} Fatal error: ${e.message}`, 'red');
  process.exit(1);
});

