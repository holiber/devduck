import path from 'node:path';
import { loadInstallState } from './install-state.js';
import { print, symbols } from '../utils.js';

type McpServerResult = {
  working?: boolean;
  optional?: boolean;
};

export function printInstallSummary(params: { workspaceRoot: string; logFilePath: string }): {
  hasFailures: boolean;
} {
  const { workspaceRoot, logFilePath } = params;
  const state = loadInstallState(workspaceRoot);

  const verify = state.steps['verify-installation']?.result;
  const verificationResults = Array.isArray(verify) ? verify : [];
  const fallbackVerify = state.executedChecks?.filter((c) => c.step === 'verify-installation') ?? [];

  const checksPassed =
    verificationResults.length > 0
      ? verificationResults.filter((r: { passed?: boolean | null }) => r.passed === true).length
      : fallbackVerify.filter((c) => c.passed === true).length;
  const checksFailed =
    verificationResults.length > 0
      ? verificationResults.filter((r: { passed?: boolean | null; requirement?: string }) => {
          if (r.passed !== false) return false;
          const req = (r.requirement || 'required').toLowerCase();
          return req === 'required';
        }).length
      : fallbackVerify.filter((c) => c.passed === false).length;
  const checksSkipped =
    verificationResults.length > 0
      ? verificationResults.filter((r: { skipped?: boolean }) => r.skipped === true).length
      : 0;
  const checksTotal = verificationResults.length > 0 ? verificationResults.length : fallbackVerify.length;
  const checksRan = Math.max(0, checksTotal - checksSkipped);

  const mcpServers = (Array.isArray(state.mcpServers) ? (state.mcpServers as McpServerResult[]) : []) || [];
  const mcpRequiredTotal = mcpServers.filter((m) => !m.optional).length;
  const mcpRequiredWorking = mcpServers.filter((m) => !m.optional && m.working).length;
  const mcpOptionalFailed = mcpServers.filter((m) => m.optional && !m.working).length;

  const verifyStepError = state.steps['verify-installation']?.error ? String(state.steps['verify-installation']?.error) : '';
  const verifyErrorIsBlocking = verifyStepError.length > 0 && !verifyStepError.toLowerCase().includes('non-blocking');

  const hasFailures =
    checksFailed > 0 ||
    verifyErrorIsBlocking ||
    state.steps['setup-modules']?.error !== undefined ||
    state.steps['setup-projects']?.error !== undefined ||
    (mcpRequiredTotal > 0 && mcpRequiredWorking !== mcpRequiredTotal);

  if (hasFailures) {
    print(`\n${symbols.warning} INSTALLATION FINISHED WITH ERRORS`, 'yellow');
  } else {
    print(`\n${symbols.success} Installation completed successfully`, 'green');
  }

  const checksMsg = `  Checks: ${checksPassed}/${checksRan} passed`;
  const checksColor = checksFailed === 0 ? 'green' : 'red';
  print(checksMsg, checksColor);

  if (mcpRequiredTotal > 0) {
    let mcpMsg = `  MCP Servers: ${mcpRequiredWorking}/${mcpRequiredTotal} required working`;
    if (mcpOptionalFailed > 0) mcpMsg += ` (+${mcpOptionalFailed} optional failed)`;
    const mcpColor = mcpRequiredWorking === mcpRequiredTotal ? 'green' : 'yellow';
    print(mcpMsg, mcpColor);
  }

  if (hasFailures) {
    const rel = path.relative(workspaceRoot, logFilePath) || logFilePath;
    print(`  ${symbols.info} See log: ${rel} (search: <check-name>)`, 'cyan');
  }

  return { hasFailures };
}


