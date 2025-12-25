#!/usr/bin/env node

/**
 * MCP module API - tRPC-like router definition
 * Provides access to MCP server information and tools
 */

import { z } from 'zod';
import { initProviderContract } from '../../scripts/lib/provider-router.js';
import { findWorkspaceRoot } from '../../scripts/lib/workspace-root.js';
import { readJSON } from '../../scripts/lib/config.js';
import path from 'path';
import fs from 'fs';
import { testMcpServer } from '../../scripts/install/mcp-test.js';
import type { ExecaChildProcess } from 'execa';
import { startProcess } from '../../scripts/lib/process.js';

/**
 * MCP provider interface (no actual provider needed, just for consistency)
 */
interface MCPProvider {
  listServers(): Promise<string[]>;
  listTools(serverName: string): Promise<string[]>;
}

const t = initProviderContract<MCPProvider>();

/**
 * Schema for MCP input (serverName is optional)
 * We'll handle it as a positional argument in the CLI
 */
const MCPInputSchema = z.object({
  serverName: z.string().optional()
});

/**
 * Schema for MCP server info (without sensitive config data like tokens)
 */
const MCPServerInfoSchema = z.object({
  name: z.string()
});

/**
 * Schema for MCP tool info
 */
const MCPToolInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional()
});

/**
 * Call MCP tool/method with parameters
 */
async function callMcpTool(
  serverName: string,
  toolName: string,
  params: Record<string, unknown>,
  serverConfig: { command?: string; args?: string[] }
): Promise<unknown> {
  const { Readable } = await import('stream');
  
  let mcpProcess: ExecaChildProcess<string> | null = null;
  let requestId = 1;
  const timeout = 30000;
  
  try {
    // Spawn MCP server process (similar to testMcpServer)
    const commandParts = (serverConfig.command || '').split(/\s+/);
    let command = commandParts[0];
    
    // Expand ~ to home directory
    if (command.startsWith('~/')) {
      command = command.replace('~/', (process.env.HOME || process.env.USERPROFILE || '~') + '/');
    }
    
    // Expand variables
    command = command.replace(/\$\$([A-Za-z_][A-Za-z0-9_]*)\$\$/g, (match, varName) => {
      return process.env[varName] || match;
    });
    command = command.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => {
      return process.env[varName] || match;
    });
    
    const commandArgs = [...commandParts.slice(1), ...(serverConfig.args || [])].map(arg => {
      let expanded = arg;
      if (expanded.startsWith('~/')) {
        expanded = expanded.replace('~/', (process.env.HOME || process.env.USERPROFILE || '~') + '/');
      }
      expanded = expanded.replace(/\$\$([A-Za-z_][A-Za-z0-9_]*)\$\$/g, (match, varName) => {
        return process.env[varName] || match;
      });
      expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => {
        return process.env[varName] || match;
      });
      return expanded;
    });
    
    mcpProcess = startProcess(command, commandArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    
    if (!mcpProcess.stdout || !mcpProcess.stdin) {
      throw new Error('Failed to create process stdio streams');
    }
    
    const timeoutId = setTimeout(() => {
      if (mcpProcess) {
        mcpProcess.kill();
        mcpProcess = null;
      }
    }, timeout);
    
    let stdoutBuffer = '';
    mcpProcess.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
    });
    
    // Wait for response helper
    const waitForResponse = (stream: Readable, timeoutMs: number): Promise<string> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for response'));
        }, timeoutMs);
        
        const checkBuffer = () => {
          const lines = stdoutBuffer.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.id === requestId) {
                  clearTimeout(timeout);
                  stdoutBuffer = lines.slice(i + 1).join('\n');
                  resolve(line);
                  return;
                }
              } catch {
                // Not JSON, continue
              }
            }
          }
          setTimeout(checkBuffer, 10);
        };
        
        checkBuffer();
      });
    };
    
    // Initialize MCP connection
    const initRequest = {
      jsonrpc: '2.0',
      id: requestId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'devduck-mcp-caller',
          version: '1.0.0'
        }
      }
    };
    
    mcpProcess.stdin.write(JSON.stringify(initRequest) + '\n');
    await waitForResponse(mcpProcess.stdout, timeout);
    
    // Send initialized notification
    mcpProcess.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }) + '\n');
    
    // Call the tool
    const callRequest = {
      jsonrpc: '2.0',
      id: requestId++,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params
      }
    };
    
    mcpProcess.stdin.write(JSON.stringify(callRequest) + '\n');
    const response = await waitForResponse(mcpProcess.stdout, timeout);
    
    clearTimeout(timeoutId);
    
    const responseData = JSON.parse(response);
    if (responseData.error) {
      throw new Error(`MCP error: ${responseData.error.message || JSON.stringify(responseData.error)}`);
    }
    
    return responseData.result;
  } finally {
    if (mcpProcess) {
      mcpProcess.kill();
    }
  }
}

/**
 * Schema for calling MCP tool
 * serverName and toolName are positional, params is optional JSON string
 */
const CallToolInputSchema = z.object({
  serverName: z.string().min(1, 'Server name is required'),
  toolName: z.string().min(1, 'Tool name is required'),
  params: z.string().optional().transform((val) => {
    if (!val) return {};
    try {
      return JSON.parse(val);
    } catch {
      throw new Error('params must be valid JSON');
    }
  }).pipe(z.record(z.unknown()))
});

/**
 * MCP router - provides MCP server and tool information
 */
export const mcpRouter = t.router({
  list: t.procedure
    .input(MCPInputSchema)
    .output(z.union([
      z.array(MCPServerInfoSchema),
      z.array(MCPToolInfoSchema)
    ]))
    .meta({
      title: 'List MCP servers or tools',
      description: 'List available MCP servers or tools for a specific server. Call without serverName to list servers, with serverName to list tools.',
      idempotent: true,
      timeoutMs: 30_000
    })
    .handler(async ({ input, ctx }) => {
      const workspaceRoot = findWorkspaceRoot(process.cwd());
      if (!workspaceRoot) {
        throw new Error('Workspace root not found');
      }

      const mcpJsonPath = path.join(workspaceRoot, '.cursor', 'mcp.json');
      if (!fs.existsSync(mcpJsonPath)) {
        return [];
      }

      const mcpConfig = readJSON<{ mcpServers?: Record<string, unknown> }>(mcpJsonPath);
      if (!mcpConfig || !mcpConfig.mcpServers) {
        return [];
      }

      const servers = mcpConfig.mcpServers;

      // Check if serverName is provided (for listing tools)
      if (input.serverName) {
        const serverName = input.serverName;
        const serverConfig = servers[serverName] as { command?: string; args?: string[] } | undefined;
        
        if (!serverConfig) {
          throw new Error(`MCP server "${serverName}" not found`);
        }

        // Get tools from MCP server
        try {
          const result = await testMcpServer(serverName, {
            command: serverConfig.command || '',
            args: serverConfig.args || []
          }, {
            timeout: 10000,
            log: () => {} // Silent logging
          });

          if (result.success && result.methods) {
            return result.methods.map(name => ({
              name,
              description: undefined
            }));
          }

          return [];
        } catch (error) {
          const err = error as Error;
          throw new Error(`Failed to get tools from MCP server "${serverName}": ${err.message}`);
        }
      }

      // List all servers (without sensitive config data)
      return Object.entries(servers).map(([name]) => {
        return {
          name
        };
      });
    }),
  
  call: t.procedure
    .input(CallToolInputSchema)
    .output(z.unknown())
    .meta({
      title: 'Call MCP tool/method',
      description: 'Call a specific tool/method on an MCP server with parameters',
      idempotent: false,
      timeoutMs: 60_000
    })
    .handler(async ({ input, ctx }) => {
      const workspaceRoot = findWorkspaceRoot(process.cwd());
      if (!workspaceRoot) {
        throw new Error('Workspace root not found');
      }

      const mcpJsonPath = path.join(workspaceRoot, '.cursor', 'mcp.json');
      if (!fs.existsSync(mcpJsonPath)) {
        throw new Error('MCP configuration not found');
      }

      const mcpConfig = readJSON<{ mcpServers?: Record<string, unknown> }>(mcpJsonPath);
      if (!mcpConfig || !mcpConfig.mcpServers) {
        throw new Error('No MCP servers configured');
      }

      const servers = mcpConfig.mcpServers;
      const serverConfig = servers[input.serverName] as { command?: string; args?: string[] } | undefined;
      
      if (!serverConfig) {
        throw new Error(`MCP server "${input.serverName}" not found`);
      }

      return await callMcpTool(
        input.serverName,
        input.toolName,
        input.params || {},
        serverConfig
      );
    })
});

