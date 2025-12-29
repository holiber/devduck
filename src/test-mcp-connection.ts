#!/usr/bin/env node

/**
 * Test MCP server connections
 * 
 * Tests connectivity to configured MCP servers by sending JSON-RPC requests
 * and verifying responses.
 */

import { testMcpServer } from './install/mcp-test.js';
import { findWorkspaceRoot } from './lib/workspace-root.js';
import { readJSON } from './lib/config.js';
import path from 'path';
import fs from 'fs';

async function main() {
  const serverName = process.argv[2];
  
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  if (!workspaceRoot) {
    console.error('Error: Workspace root not found');
    process.exit(1);
  }

  const mcpJsonPath = path.join(workspaceRoot, '.cursor', 'mcp.json');
  if (!fs.existsSync(mcpJsonPath)) {
    console.error('Error: MCP configuration not found at', mcpJsonPath);
    console.error('No MCP servers configured.');
    process.exit(1);
  }

  const mcpConfig = readJSON<{ mcpServers?: Record<string, unknown> }>(mcpJsonPath);
  if (!mcpConfig || !mcpConfig.mcpServers) {
    console.error('Error: No MCP servers configured');
    process.exit(1);
  }

  const servers = mcpConfig.mcpServers;
  const serverNames = Object.keys(servers);

  if (serverNames.length === 0) {
    console.error('Error: No MCP servers found in configuration');
    process.exit(1);
  }

  // Test specific server or all servers
  const serversToTest = serverName 
    ? [serverName]
    : serverNames;

  if (serverName && !servers[serverName]) {
    console.error(`Error: MCP server "${serverName}" not found`);
    console.error(`Available servers: ${serverNames.join(', ')}`);
    process.exit(1);
  }

  console.log(`Testing ${serversToTest.length} MCP server(s)...\n`);

  let successCount = 0;
  let failCount = 0;

  for (const name of serversToTest) {
    const serverConfig = servers[name] as { command?: string; args?: string[]; url?: string } | undefined;
    
    if (!serverConfig) {
      console.error(`  ✗ ${name}: Configuration not found`);
      failCount++;
      continue;
    }

    // Skip URL-based servers (they can't be tested this way)
    if (serverConfig.url) {
      console.log(`  ℹ ${name}: URL-based server (skipping test)`);
      continue;
    }

    // Skip servers without command
    if (!serverConfig.command) {
      console.log(`  ℹ ${name}: No command configured (skipping test)`);
      continue;
    }

    const result = await testMcpServer(
      name,
      {
        command: serverConfig.command,
        args: serverConfig.args || []
      },
      {
        timeout: 10000,
        log: (msg: string) => console.log(`    ${msg}`),
        workspaceRoot
      }
    );

    if (result.success) {
      console.log(`  ✓ ${name}: Connection successful`);
      if (result.methods && result.methods.length > 0) {
        console.log(`    Methods: ${result.methods.length} (${result.methods.slice(0, 5).join(', ')}${result.methods.length > 5 ? '...' : ''})`);
      }
      if (result.resources && result.resources.length > 0) {
        console.log(`    Resources: ${result.resources.length}`);
      }
      successCount++;
    } else {
      console.error(`  ✗ ${name}: Connection failed`);
      if (result.error) {
        console.error(`    Error: ${result.error}`);
      }
      if (result.timeout) {
        console.error(`    Timeout: Server did not respond within timeout period`);
      }
      failCount++;
    }
    console.log('');
  }

  console.log(`\nSummary: ${successCount} successful, ${failCount} failed`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
