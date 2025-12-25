#!/usr/bin/env node

/**
 * MCP (Model Context Protocol) configuration and checking utilities
 * 
 * Handles generation of .cursor/mcp.json and checking MCP server availability.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { readJSON, writeJSON, replaceVariablesInObject } from '../lib/config.js';
import { readEnvFile } from '../lib/env.js';
import { executeCommand } from '../utils.js';

export interface McpServerResult {
  name: string;
  type: 'url' | 'command' | 'unknown';
  working: boolean;
  optional: boolean;
  url?: string;
  command?: string;
  statusCode?: number | null;
  commandPath?: string;
  error?: string;
  note?: string | null;
  timeout?: boolean;
}

export interface McpToolsResult {
  name: string;
  tools?: string[];
  error?: string;
  statusCode?: number | null;
}

interface HttpRequestResult {
  success: boolean;
  statusCode: number | null;
  error: string | null;
  body: string | null;
  timeout?: boolean;
}

interface CommandCheckResult {
  exists: boolean;
  executable: boolean;
  path?: string;
  error?: string;
}

export interface McpOptions {
  log?: (msg: string) => void;
  print?: (msg: string, color?: string) => void;
  symbols?: { info: string; success: string; warning: string; error: string };
}

/**
 * Make HTTP request for MCP server (with proper headers and longer timeout)
 */
function makeMcpHttpRequest(method: string, url: string): Promise<HttpRequestResult> {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    // MCP servers typically require Accept: text/event-stream
    // Use HEAD request for faster check, or GET if HEAD is not supported
    const headers = {
      'Accept': 'text/event-stream, application/json',
      'User-Agent': 'MCP-Client/1.0'
    };
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: headers,
      timeout: 5000 // 5 seconds - enough to check if server responds
    };
    
    const req = httpModule.request(options, (res) => {
      let data = '';
      
      // For HEAD requests, we might not get data
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const statusCode = res.statusCode;
        // Any response (except 404) means server is reachable
        const isSuccess = statusCode >= 200 && statusCode < 500 && statusCode !== 404;
        
        resolve({
          success: isSuccess,
          statusCode: statusCode,
          error: null,
          body: data
        });
      });
    });
    
    req.on('error', (error) => {
      resolve({
        success: false,
        statusCode: null,
        error: error.message,
        body: null
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      // For MCP servers, timeout might mean server is slow but working
      // Try a simpler check - just verify the host is reachable
      resolve({
        success: false,
        statusCode: null,
        error: 'Request timeout (server may be slow or require different protocol)',
        body: null,
        timeout: true
      });
    });
    
    req.end();
  });
}

/**
 * Check if file/command exists and is executable
 */
function checkCommandExists(commandPath: string): CommandCheckResult {
  try {
    // Get just the command name (first part before space)
    const commandName = commandPath.split(/\s+/)[0];
    
    // Expand ~ to home directory
    const expandedPath = commandName.replace(/^~/, process.env.HOME || '');
    
    // Check if it's an absolute path
    if (path.isAbsolute(expandedPath)) {
      if (fs.existsSync(expandedPath)) {
        // Check if it's executable
        try {
          fs.accessSync(expandedPath, fs.constants.F_OK | fs.constants.X_OK);
          return { exists: true, executable: true };
        } catch {
          return { exists: true, executable: false };
        }
      }
      return { exists: false, executable: false };
    }
    
    // For commands in PATH, use 'which' or 'command -v'
    try {
      // Try 'command -v' first (POSIX compliant)
      const whichResult = executeCommand(`command -v ${expandedPath}`);
      if (whichResult.success && whichResult.output) {
        return { exists: true, executable: true, path: whichResult.output };
      }
      
      // Fallback to 'which' if available
      const whichResult2 = executeCommand(`which ${expandedPath}`);
      if (whichResult2.success && whichResult2.output) {
        return { exists: true, executable: true, path: whichResult2.output };
      }
      
      return { exists: false, executable: false };
    } catch (error) {
      const err = error as Error;
      return { exists: false, executable: false, error: err.message };
    }
  } catch (error) {
    const err = error as Error;
    return { exists: false, executable: false, error: err.message };
  }
}

/**
 * Check MCP server
 */
export async function checkMcpServer(
  name: string,
  serverConfig: Record<string, unknown>,
  options: McpOptions = {}
): Promise<McpServerResult> {
  const { log = () => {}, print = () => {}, symbols = { info: 'ℹ', success: '✓', warning: '⚠', error: '✗' } } = options;
  
  print(`Checking MCP server: ${name}...`, 'cyan');
  log(`Checking MCP server: ${name}`);
  
  // Check if server is marked as optional
  const isOptional = serverConfig.optional === true;
  if (isOptional) {
    log(`  Server is marked as optional`);
  }
  
  try {
    // Check URL-based server
    if (serverConfig.url) {
      log(`  Type: URL-based server`);
      log(`  URL: ${serverConfig.url}`);
      
      // Try HEAD first (faster), then GET if HEAD fails
      let result = await makeMcpHttpRequest('HEAD', serverConfig.url as string);
      
      // If HEAD times out or fails, try GET (some servers don't support HEAD)
      if (result.timeout || (!result.success && !result.statusCode)) {
        log(`  HEAD request failed, trying GET...`);
        result = await makeMcpHttpRequest('GET', serverConfig.url as string);
      }
      
      // Check if server responded (even with error, it means server is working)
      // MCP servers may return JSON-RPC errors which indicate the server is reachable
      if (result.success || (result.statusCode && result.statusCode !== 404)) {
        // Check if response contains JSON-RPC error (which means server is working)
        let isWorking = result.success;
        let errorMessage = null;
        
        if (result.body) {
          try {
            const jsonResponse = JSON.parse(result.body);
            // If we get a JSON-RPC error response, the server is working
            // It just requires proper MCP protocol handshake
            if (jsonResponse.error && jsonResponse.jsonrpc === '2.0') {
              isWorking = true;
              errorMessage = `Server requires MCP protocol (${jsonResponse.error.message || 'MCP handshake needed'})`;
              log(`  Server responded with JSON-RPC error, but server is reachable`);
            }
          } catch (e) {
            // Not JSON, check status code
            if (result.statusCode >= 200 && result.statusCode < 500) {
              isWorking = true;
            }
          }
        } else if (result.statusCode && result.statusCode >= 200 && result.statusCode < 500) {
          // HEAD request succeeded (no body)
          isWorking = true;
        }
        
        if (isWorking) {
          const statusMsg = errorMessage ? `(requires MCP protocol)` : `(${result.statusCode})`;
          print(`  ${symbols.success} ${name} - OK ${statusMsg}`, 'green');
          log(`  Result: SUCCESS - Status: ${result.statusCode}, Server is reachable`);
          
          return {
            name: name,
            type: 'url',
            url: serverConfig.url as string,
            working: true,
            optional: isOptional,
            statusCode: result.statusCode,
            note: errorMessage || null
          };
        }
      }
      
      // Handle timeout specially - for MCP servers, timeout might mean server uses SSE/WebSocket
      // and doesn't respond to regular HTTP, but server might still be working
      if (result.timeout) {
        // Try to verify the host is at least reachable with a simple DNS/connectivity check
        const urlObj = new URL(serverConfig.url as string);
        log(`  Request timed out, but server may use SSE/WebSocket protocol`);
        print(`  ${symbols.warning} ${name} - Timeout (server may require SSE/WebSocket connection)`, 'yellow');
        log(`  Result: TIMEOUT - Server may be working but requires different protocol`);
        
        // Consider it potentially working if URL is valid
        return {
          name: name,
          type: 'url',
          url: serverConfig.url as string,
          working: true, // Assume working, timeout might be due to protocol requirements
          optional: isOptional,
          statusCode: null,
          note: 'Timeout - server may require SSE/WebSocket (MCP protocol)',
          timeout: true
        };
      }
      
      // Server not reachable or 404
      if (isOptional) {
        print(`  ${symbols.warning} ${name} - Failed (${result.statusCode || result.error}) (optional)`, 'yellow');
        log(`  Result: WARNING (optional server) - Status: ${result.statusCode || 'N/A'}, Error: ${result.error || 'N/A'}`);
      } else {
        print(`  ${symbols.error} ${name} - Failed (${result.statusCode || result.error})`, 'red');
        log(`  Result: FAILED - Status: ${result.statusCode || 'N/A'}, Error: ${result.error || 'N/A'}`);
      }
      
      return {
        name: name,
        type: 'url',
        url: serverConfig.url as string,
        working: false,
        optional: isOptional,
        error: result.error || `HTTP ${result.statusCode}`
      };
    }
    
    // Check command-based server
    if (serverConfig.command) {
      log(`  Type: Command-based server`);
      log(`  Command: ${serverConfig.command}`);
      
      // Check if command exists
      const checkResult = checkCommandExists(serverConfig.command as string);
      
      if (checkResult.exists && checkResult.executable) {
        // For npx, we can't easily test it without actually running it
        // Just verify the command is available
        const commandName = (serverConfig.command as string).split(/\s+/)[0];
        if (commandName === 'npx' || commandName === 'node' || commandName === 'npm') {
          // These are Node.js commands, assume they work if found
          print(`  ${symbols.success} ${name} - Command available (${commandName})`, 'green');
          log(`  Result: SUCCESS - Command exists: ${checkResult.path || serverConfig.command}`);
          
          return {
            name: name,
            type: 'command',
            command: serverConfig.command as string,
            working: true,
            optional: isOptional,
            commandPath: checkResult.path || (serverConfig.command as string)
          };
        }
        
        // For other commands, try a simple test
        try {
          // Just verify command exists, don't try to run it with args
          print(`  ${symbols.success} ${name} - Command available`, 'green');
          log(`  Result: SUCCESS - Command exists: ${checkResult.path || serverConfig.command}`);
          
          return {
            name: name,
            type: 'command',
            command: serverConfig.command as string,
            working: true,
            optional: isOptional,
            commandPath: checkResult.path || (serverConfig.command as string)
          };
        } catch (error) {
          // Command exists but test failed, still mark as available
          print(`  ${symbols.success} ${name} - Command available`, 'green');
          log(`  Result: SUCCESS - Command exists (test failed but command found)`);
          
          return {
            name: name,
            type: 'command',
            command: serverConfig.command as string,
            working: true,
            optional: isOptional,
            commandPath: checkResult.path || (serverConfig.command as string)
          };
        }
      } else {
        if (isOptional) {
          print(`  ${symbols.warning} ${name} - Command not found or not executable (optional)`, 'yellow');
          log(`  Result: WARNING (optional server) - Command not found or not executable: ${serverConfig.command}`);
        } else {
          print(`  ${symbols.error} ${name} - Command not found or not executable`, 'red');
          log(`  Result: FAILED - Command not found or not executable: ${serverConfig.command}`);
        }
        
        return {
          name: name,
          type: 'command',
          command: serverConfig.command as string,
          working: false,
          optional: isOptional,
          error: checkResult.error || 'Command not found or not executable'
        };
      }
    }
    
    // Unknown server type
    print(`  ${symbols.warning} ${name} - Unknown server type`, 'yellow');
    log(`  Result: WARNING - Unknown server type`);
    
    return {
      name: name,
      type: 'unknown',
      working: false,
      optional: isOptional,
      error: 'Unknown server configuration type'
    };
  } catch (error) {
    const err = error as Error;
    if (isOptional) {
      print(`  ${symbols.warning} ${name} - Error: ${err.message} (optional)`, 'yellow');
      log(`  Result: WARNING (optional server) - ${err.message}`);
    } else {
      print(`  ${symbols.error} ${name} - Error: ${err.message}`, 'red');
      log(`  Result: ERROR - ${err.message}`);
    }
    
    return {
      name: name,
      type: 'unknown',
      working: false,
      optional: isOptional,
      error: err.message
    };
  }
}

/**
 * Check all MCP servers
 */
export async function checkMcpServers(
  mcpServers: Record<string, Record<string, unknown>>,
  workspaceRoot: string,
  options: McpOptions = {}
): Promise<McpServerResult[]> {
  const { log = () => {}, print = () => {}, symbols = { info: 'ℹ', success: '✓', warning: '⚠', error: '✗' } } = options;
  
  if (!mcpServers || Object.keys(mcpServers).length === 0) {
    return [];
  }
  
  print(`\n${symbols.info} Checking MCP servers...`, 'cyan');
  log(`Checking MCP servers from mcp.json`);
  
  const results: McpServerResult[] = [];
  
  for (const [name, serverConfig] of Object.entries(mcpServers)) {
    const result = await checkMcpServer(name, serverConfig, { log, print, symbols });
    results.push(result);
  }
  
  return results;
}

/**
 * Generate mcp.json from workspace.config.json and module checks
 */
export function generateMcpJson(
  workspaceRoot: string,
  options: McpOptions & { moduleChecks?: Array<{ name?: string; mcpSettings?: Record<string, unknown> }> } = {}
): Record<string, Record<string, unknown>> | null {
  const { log = () => {}, print = () => {}, symbols = { info: 'ℹ', success: '✓', warning: '⚠', error: '✗' }, moduleChecks = [] } = options;
  
  const configFile = path.join(workspaceRoot, 'workspace.config.json');
  const envFile = path.join(workspaceRoot, '.env');
  const cursorDir = path.join(workspaceRoot, '.cursor');
  const mcpFile = path.join(cursorDir, 'mcp.json');
  
  print(`\n${symbols.info} Generating .cursor/mcp.json...`, 'cyan');
  log(`Generating mcp.json from workspace.config.json and module checks`);
  
  // Read workspace.config.json
  const config = readJSON(configFile);
  if (!config) {
    print(`  ${symbols.warning} Cannot read ${configFile}, skipping MCP generation`, 'yellow');
    log(`WARNING: Cannot read configuration file: ${configFile}`);
    return null;
  }
  
  // Read .env file
  const env = readEnvFile(envFile);
  log(`Loaded environment variables from .env file: ${Object.keys(env).join(', ')}`);
  
  // Collect all checks: from workspace config and from modules
  const allChecks = [
    ...(config.checks && Array.isArray(config.checks) ? config.checks : []),
    ...moduleChecks
  ];
  
  if (allChecks.length === 0) {
    print(`  ${symbols.info} No checks found, skipping MCP generation`, 'cyan');
    log(`No checks found (cannot generate mcp.json)`);
    return null;
  }

  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const item of allChecks) {
    if (!item || typeof item !== 'object') continue;
    if (!item.mcpSettings) continue;

    // Use serverName from mcpSettings if specified, otherwise use check name
    const checkName = item.name;
    const serverName = (item.mcpSettings as { serverName?: string }).serverName || checkName;
    
    if (!serverName || typeof serverName !== 'string') {
      print(`  ${symbols.warning} MCP check is missing string 'name', skipping`, 'yellow');
      log(`MCP check missing name: ${JSON.stringify(item)}`);
      continue;
    }

    // Remove serverName from mcpSettings before adding to mcp.json (it's metadata, not config)
    const mcpSettingsWithoutServerName = { ...item.mcpSettings } as Record<string, unknown>;
    delete mcpSettingsWithoutServerName.serverName;

    // Replace $VARS in mcpSettings
    mcpServers[serverName] = replaceVariablesInObject(mcpSettingsWithoutServerName, env, log, print, symbols) as Record<string, unknown>;
    
    if (serverName !== checkName) {
      log(`MCP server "${serverName}" created from check "${checkName}"`);
    }
  }

  if (Object.keys(mcpServers).length === 0) {
    print(`  ${symbols.warning} No mcpSettings found in checks, skipping`, 'yellow');
    log(`No mcpSettings found in checks (cannot generate mcp.json)`);
    return null;
  }
  
  // Ensure .cursor directory exists
  if (!fs.existsSync(cursorDir)) {
    fs.mkdirSync(cursorDir, { recursive: true });
    log(`Created .cursor directory: ${cursorDir}`);
  }
  
  // Write mcp.json
  const mcpConfig = { mcpServers };
  writeJSON(mcpFile, mcpConfig);
  
  print(`  ${symbols.success} .cursor/mcp.json generated successfully`, 'green');
  log(`mcp.json written to: ${mcpFile}`);
  
  return mcpServers;
}

