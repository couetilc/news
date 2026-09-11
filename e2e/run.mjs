import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Every invocation owns its build, bindings and port. Never reuse a dev server.
const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(join(root, '.playwright'), { recursive: true });
const runDir = mkdtempSync(join(root, '.playwright/run-'));
const reservation = createServer();
await new Promise((resolve, reject) => {
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', resolve);
});
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
console.log(`[e2e] isolated run: ${runDir}, port ${port}`);
const child = spawn(process.execPath, [
  join(root, 'node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(2),
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NEWS_E2E_RUN_DIR: runDir, NEWS_E2E_PORT: String(port) },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('close', (code) => {
  rmSync(runDir, { recursive: true, force: true });
  process.exitCode = code ?? 1;
});
