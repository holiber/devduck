import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const pidFile = process.env.CHILD_PID_FILE || '';
if (!pidFile) {
  // eslint-disable-next-line no-console
  console.error('Missing CHILD_PID_FILE');
  process.exit(1);
}

const childScript = path.join(path.dirname(pidFile), 'child-interval.ts');

const child = spawn('npx', ['tsx', childScript], {
  stdio: 'ignore',
  env: { ...process.env }
});

if (!child.pid) {
  // eslint-disable-next-line no-console
  console.error('Failed to spawn child');
  process.exit(1);
}

fs.writeFileSync(pidFile, String(child.pid), 'utf8');

// Keep parent alive.
setInterval(() => {
  // keep alive
}, 1000).unref();

