import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pidFile = process.env.CHILD_PID_FILE || '';
if (!pidFile) {
  // eslint-disable-next-line no-console
  console.error('Missing CHILD_PID_FILE');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const childScript = path.join(__dirname, 'child-interval.mjs');

const child = spawn(process.execPath, [childScript], {
  stdio: 'ignore',
  env: { ...process.env }
});

if (!child.pid) {
  // eslint-disable-next-line no-console
  console.error('Failed to spawn child');
  process.exit(1);
}

fs.writeFileSync(pidFile, String(child.pid), 'utf8');

setInterval(() => {
  // keep alive
}, 1000);

