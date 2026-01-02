#!/usr/bin/env node

/**
 * MCP API - tRPC-like router definition
 * Provides access to MCP server information and tools
 */

import { z } from 'zod';
import { initProviderContract } from '../router.js';
import { findWorkspaceRoot } from '../workspace-root.js';
import { readJSON } from '../config.js';
import path from 'path';
import fs from 'fs';

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
  description: z.string().optional(),
  // MCP canonical tools/list returns JSON schema under inputSchema
  inputSchema: z.unknown().optional()
});

type McpServerConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
};

function normalizeMcpServerConfig(raw: unknown): McpServerConfig {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;

  // Support both shapes:
  // 1) Cursor `.cursor/mcp.json` format: { command, args, env, url, ... }
  // 2) Barducks-like/check-like format mistakenly placed into `.cursor/mcp.json`:
  //    { description, install, mcpSettings: { command, args, env, url, ... } }
  const nested =
    obj.mcpSettings && typeof obj.mcpSettings === 'object'
      ? (obj.mcpSettings as Record<string, unknown>)
      : null;
  const src = nested || obj;

  const command = typeof src.command === 'string' ? src.command : undefined;
  const url = typeof src.url === 'string' ? src.url : undefined;
  const args = Array.isArray(src.args)
    ? (src.args.filter((x) => typeof x === 'string') as string[])
    : undefined;

  const envRaw = src.env;
  const env =
    envRaw && typeof envRaw === 'object'
      ? Object.fromEntries(
          Object.entries(envRaw as Record<string, unknown>).filter(([, v]) => typeof v === 'string')
        )
      : undefined;

  return { command, args, env, url };
}

function expandValue(v: string): string {
  let out = String(v || '');

  // Expand ~ to home directory
  if (out.startsWith('~/')) {
    out = out.replace('~/', (process.env.HOME || process.env.USERPROFILE || '~') + '/');
  }

  // Expand $$VAR$$ and $VAR
  out = out.replace(/\$\$([A-Za-z_][A-Za-z0-9_]*)\$\$/g, (match, varName) => process.env[varName] || match);
  out = out.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => process.env[varName] || match);

  return out;
}

function expandCommandAndArgs(serverConfig: McpServerConfig): { command: string; args: string[]; env: Record<string, string> } {
  // IMPORTANT: `command` is a single executable path/name (Cursor format). Do NOT split it.
  const command = expandValue(String(serverConfig.command || '').trim());
  const args = (serverConfig.args || []).map((a) => expandValue(String(a)));
  const env = { ...process.env, ...(serverConfig.env || {}) } as Record<string, string>;
  return { command, args, env };
}

function tailLines(lines: string[], maxLines: number): string {
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(-maxLines).join('\n');
}

async function spawnMcpClient(serverName: string, serverConfig: McpServerConfig, timeoutMs: number): Promise<{
  request: (method: string, params?: Record<string, unknown>, requestTimeoutMs?: number) => Promise<any>;
  close: () => void;
}> {
  const { spawn } = await import('child_process');

  const { command, args, env } = expandCommandAndArgs(serverConfig);
  if (!command) {
    const url = String(serverConfig.url || '').trim();
    if (url) {
      throw new Error(
        `MCP server "${serverName}" is URL-based (${url}). barducks CLI currently supports only command-based MCP servers.`
      );
    }
    throw new Error(`MCP server "${serverName}" is missing command`);
  }

  const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
  if (!proc.stdin || !proc.stdout || !proc.stderr) {
    proc.kill();
    throw new Error(`Failed to create stdio for MCP server "${serverName}"`);
  }

  let closed = false;
  let requestId = 1;

  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }>();
  const stderrLines: string[] = [];
  const maxStderrLines = 50;

  const rejectAll = (err: Error) => {
    for (const [id, p] of pending.entries()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
      pending.delete(id);
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    rejectAll(
      new Error(
        `MCP server "${serverName}" closed.\n` +
          (stderrLines.length ? `stderr (last ${Math.min(maxStderrLines, stderrLines.length)} lines):\n${tailLines(stderrLines, maxStderrLines)}` : '')
      )
    );
    try {
      proc.kill();
    } catch {
      // ignore
    }
    proc.removeAllListeners();
    proc.stdout.removeAllListeners();
    proc.stderr.removeAllListeners();
    proc.stdin.removeAllListeners();
  };

  proc.on('error', (e) => {
    rejectAll(new Error(`Failed to start MCP server "${serverName}": ${(e as Error)?.message || String(e)}`));
    close();
  });
  proc.on('exit', (code, signal) => {
    const msg = `MCP server "${serverName}" exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`;
    rejectAll(
      new Error(
        msg +
          (stderrLines.length ? `\nstderr (last ${Math.min(maxStderrLines, stderrLines.length)} lines):\n${tailLines(stderrLines, maxStderrLines)}` : '')
      )
    );
    close();
  });

  proc.stderr.on('data', (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split('\n')) {
      const trimmed = line.replace(/\r$/, '');
      if (!trimmed) continue;
      stderrLines.push(trimmed);
      if (stderrLines.length > maxStderrLines) stderrLines.shift();
    }
  });

  let stdoutBuf = '';
  const onStdoutData = (data: Buffer) => {
    stdoutBuf += data.toString();
    let idx: number;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: any };
        if (typeof msg.id === 'number' && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          if (p.timer) clearTimeout(p.timer);
          pending.delete(msg.id);
          if ((msg as any).error) {
            p.reject(new Error((msg as any).error?.message || JSON.stringify((msg as any).error)));
          } else {
            p.resolve((msg as any).result);
          }
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  };
  proc.stdout.on('data', onStdoutData);

  const request = (method: string, params?: Record<string, unknown>, requestTimeoutMs?: number) => {
    if (closed) {
      return Promise.reject(new Error(`MCP server "${serverName}" is closed`));
    }
    const id = requestId++;
    const payload: Record<string, unknown> = { jsonrpc: '2.0', id, method };
    if (params !== undefined) payload.params = params;

    const effectiveTimeout = typeof requestTimeoutMs === 'number' ? requestTimeoutMs : timeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        try {
          proc.kill();
        } catch {
          // ignore
        }
        reject(
          new Error(
            `Timeout waiting for MCP response (server="${serverName}", method="${method}", id=${id}).\n` +
              (stderrLines.length
                ? `stderr (last ${Math.min(maxStderrLines, stderrLines.length)} lines):\n${tailLines(stderrLines, maxStderrLines)}`
                : '')
          )
        );
      }, effectiveTimeout);

      pending.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify(payload) + '\n');
    });
  };

  // Initialize protocol
  await request(
    'initialize',
    {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'barducks-mcp', version: '1.0.0' }
    },
    timeoutMs
  );
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  return { request, close };
}

/**
 * Call MCP tool/method with parameters
 */
async function callMcpTool(
  serverName: string,
  toolName: string,
  params: Record<string, unknown>,
  serverConfig: McpServerConfig
): Promise<unknown> {
  const client = await spawnMcpClient(serverName, serverConfig, 30_000);
  try {
    return await client.request('tools/call', { name: toolName, arguments: params }, 60_000);
  } finally {
    client.close();
  }
}

async function listMcpToolsDetailed(
  serverName: string,
  serverConfig: McpServerConfig,
  timeoutMs = 10_000
): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
  const client = await spawnMcpClient(serverName, serverConfig, timeoutMs);
  try {
    const res = await client.request('tools/list', {}, timeoutMs);
    const tools = (res && typeof res === 'object' && 'tools' in (res as any) ? (res as any).tools : null) as
      | Array<{ name?: unknown; description?: unknown; inputSchema?: unknown }>
      | null;
    if (!Array.isArray(tools)) return [];
    return tools
      .filter((t) => t && typeof t === 'object' && typeof t.name === 'string')
      .map((t) => ({
        name: String(t.name),
        description: typeof t.description === 'string' ? t.description : undefined,
        inputSchema: t.inputSchema
      }));
  } finally {
    client.close();
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
 * Schema for checking if a tool exists
 */
const HasToolInputSchema = z.object({
  serverName: z.string().min(1, 'Server name is required'),
  toolName: z.string().min(1, 'Tool name is required')
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
        const serverConfig = normalizeMcpServerConfig(servers[serverName]);
        
        if (!serverConfig.command && !serverConfig.url) {
          throw new Error(`MCP server "${serverName}" not found`);
        }

        const tools = await listMcpToolsDetailed(serverName, serverConfig, 10_000);
        return tools;
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
      const serverConfig = normalizeMcpServerConfig(servers[input.serverName]);
      
      if (!serverConfig.command && !serverConfig.url) {
        throw new Error(`MCP server "${input.serverName}" not found`);
      }

      return await callMcpTool(
        input.serverName,
        input.toolName,
        input.params || {},
        serverConfig
      );
    }),

  hasTool: t.procedure
    .input(HasToolInputSchema)
    .output(z.boolean())
    .meta({
      title: 'Check if MCP tool exists',
      description: 'Check if a specific tool exists in the given MCP server',
      idempotent: true,
      timeoutMs: 30_000
    })
    .handler(async ({ input }) => {
      const workspaceRoot = findWorkspaceRoot(process.cwd());
      if (!workspaceRoot) {
        throw new Error('Workspace root not found');
      }

      const mcpJsonPath = path.join(workspaceRoot, '.cursor', 'mcp.json');
      if (!fs.existsSync(mcpJsonPath)) {
        return false;
      }

      const mcpConfig = readJSON<{ mcpServers?: Record<string, unknown> }>(mcpJsonPath);
      if (!mcpConfig || !mcpConfig.mcpServers) {
        return false;
      }

      const servers = mcpConfig.mcpServers;
      const serverConfig = normalizeMcpServerConfig(servers[input.serverName]);
      if (!serverConfig.command && !serverConfig.url) {
        throw new Error(`MCP server "${input.serverName}" not found`);
      }

      try {
        const tools = await listMcpToolsDetailed(input.serverName, serverConfig, 10_000);
        return tools.some((t) => t.name === input.toolName);
      } catch {
        // ignore and return false
      }

      return false;
    })
});

