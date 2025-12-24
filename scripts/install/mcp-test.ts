#!/usr/bin/env node

/**
 * MCP server testing utilities
 * 
 * Tests MCP server connectivity and functionality by sending JSON-RPC requests
 * and verifying responses.
 */

import { spawn, ChildProcess } from 'child_process';
import { Readable } from 'stream';

export interface McpTestResult {
  success: boolean;
  error?: string;
  methods?: string[];
  resources?: string[];
  timeout?: boolean;
}

export interface McpTestOptions {
  timeout?: number;
  log?: (msg: string) => void;
}

/**
 * Test MCP server by sending initialize request and listing tools/resources
 */
export async function testMcpServer(
  name: string,
  serverConfig: {
    command: string;
    args?: string[];
    [key: string]: unknown;
  },
  options: McpTestOptions = {}
): Promise<McpTestResult> {
  const { timeout = 10000, log = () => {} } = options;
  
  log(`Testing MCP server: ${name}`);
  log(`  Command: ${serverConfig.command} ${(serverConfig.args || []).join(' ')}`);
  
  let mcpProcess: ChildProcess | null = null;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let requestId = 1;
  
  try {
    // Spawn MCP server process
    const commandParts = serverConfig.command.split(/\s+/);
    let command = commandParts[0];
    
    // Expand ~ to home directory
    if (command.startsWith('~/')) {
      command = command.replace('~/', (process.env.HOME || process.env.USERPROFILE || '~') + '/');
    }
    
    // Expand $VAR and $$VAR$$ in command
    command = command.replace(/\$\$([A-Za-z_][A-Za-z0-9_]*)\$\$/g, (match, varName) => {
      return process.env[varName] || match;
    });
    command = command.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => {
      return process.env[varName] || match;
    });
    
    // Expand variables in args
    const commandArgs = [...commandParts.slice(1), ...(serverConfig.args || [])].map(arg => {
      let expanded = arg;
      // Expand ~
      if (expanded.startsWith('~/')) {
        expanded = expanded.replace('~/', (process.env.HOME || process.env.USERPROFILE || '~') + '/');
      }
      // Expand $$VAR$$
      expanded = expanded.replace(/\$\$([A-Za-z_][A-Za-z0-9_]*)\$\$/g, (match, varName) => {
        return process.env[varName] || match;
      });
      // Expand $VAR
      expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => {
        return process.env[varName] || match;
      });
      return expanded;
    });
    
    mcpProcess = spawn(command, commandArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    
    if (!mcpProcess.stdout || !mcpProcess.stdin) {
      return {
        success: false,
        error: 'Failed to create process stdio streams'
      };
    }
    
    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (mcpProcess) {
        mcpProcess.kill();
        mcpProcess = null;
      }
    }, timeout);
    
    // Collect stdout
    mcpProcess.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
    });
    
    // Collect stderr
    mcpProcess.stderr?.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
    });
    
    // Wait a bit for process to start
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (!mcpProcess || !mcpProcess.stdin || !mcpProcess.stdout) {
      return {
        success: false,
        error: 'Process stdio streams not available'
      };
    }
    
    // Send initialize request
    const initRequest = {
      jsonrpc: '2.0',
      id: requestId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'devduck-mcp-test',
          version: '1.0.0'
        }
      }
    };
    
    log(`  Sending initialize request...`);
    mcpProcess.stdin.write(JSON.stringify(initRequest) + '\n');
    
    // Wait for initialize response
    await waitForResponse(mcpProcess.stdout, timeout);
    
    // Send tools/list request
    const toolsRequest = {
      jsonrpc: '2.0',
      id: requestId++,
      method: 'tools/list',
      params: {}
    };
    
    log(`  Sending tools/list request...`);
    mcpProcess.stdin.write(JSON.stringify(toolsRequest) + '\n');
    
    // Wait for tools/list response
    const toolsResponse = await waitForResponse(mcpProcess.stdout, timeout);
    
    // Send resources/list request
    const resourcesRequest = {
      jsonrpc: '2.0',
      id: requestId++,
      method: 'resources/list',
      params: {}
    };
    
    log(`  Sending resources/list request...`);
    mcpProcess.stdin.write(JSON.stringify(resourcesRequest) + '\n');
    
    // Wait for resources/list response
    const resourcesResponse = await waitForResponse(mcpProcess.stdout, timeout);
    
    clearTimeout(timeoutId);
    
    // Parse responses
    const methods: string[] = [];
    const resources: string[] = [];
    
    if (toolsResponse) {
      try {
        const toolsData = JSON.parse(toolsResponse);
        if (toolsData.result && Array.isArray(toolsData.result.tools)) {
          for (const tool of toolsData.result.tools) {
            if (tool.name) {
              methods.push(tool.name);
            }
          }
        }
      } catch (e) {
        log(`  Warning: Failed to parse tools/list response`);
      }
    }
    
    if (resourcesResponse) {
      try {
        const resourcesData = JSON.parse(resourcesResponse);
        if (resourcesData.result && Array.isArray(resourcesData.result.resources)) {
          for (const resource of resourcesData.result.resources) {
            if (resource.uri) {
              resources.push(resource.uri);
            }
          }
        }
      } catch (e) {
        log(`  Warning: Failed to parse resources/list response`);
      }
    }
    
    // Clean up
    if (mcpProcess) {
      mcpProcess.kill();
      mcpProcess = null;
    }
    
    // Success if we got at least initialize response
    if (stdoutBuffer.trim()) {
      log(`  Success: Server responded (methods: ${methods.length}, resources: ${resources.length})`);
      return {
        success: true,
        methods: methods.length > 0 ? methods : undefined,
        resources: resources.length > 0 ? resources : undefined
      };
    }
    
    return {
      success: false,
      error: 'No response from server',
      timeout: true
    };
    
  } catch (error) {
    const err = error as Error;
    log(`  Error: ${err.message}`);
    
    if (mcpProcess) {
      mcpProcess.kill();
    }
    
    return {
      success: false,
      error: err.message,
      timeout: err.message.includes('timeout')
    };
  }
}

/**
 * Wait for JSON-RPC response from stdout stream
 */
function waitForResponse(
  stream: Readable,
  timeout: number
): Promise<string | null> {
  return new Promise((resolve) => {
    let buffer = '';
    let timeoutId: NodeJS.Timeout;
    
    const onData = (data: Buffer) => {
      buffer += data.toString();
      
      // Try to find complete JSON-RPC messages (lines ending with \n)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        try {
          const parsed = JSON.parse(trimmed);
          // Check if it's a JSON-RPC response
          if (parsed.jsonrpc === '2.0' && (parsed.result !== undefined || parsed.error !== undefined)) {
            stream.removeListener('data', onData);
            clearTimeout(timeoutId);
            resolve(trimmed);
            return;
          }
        } catch (e) {
          // Not valid JSON, continue
        }
      }
    };
    
    stream.on('data', onData);
    
    timeoutId = setTimeout(() => {
      stream.removeListener('data', onData);
      resolve(null);
    }, timeout);
  });
}

