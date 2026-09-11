import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, statSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

// Read-only fingerprints of development state; do not display file contents.
function snapshot() {
  const files = {};
  function walk(path) {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path).sort()) walk(join(path, entry));
    } else files[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  for (const path of ['.dev.vars', '.wrangler/state', '.wrangler/deploy', '.astro', 'dist']) walk(path);
  return files;
}
const before = snapshot();
const runsBefore = new Set(existsSync('playwright-report') ? readdirSync('playwright-report') : []);
const evidenceDir = '.playwright/isolation-evidence';
mkdirSync(evidenceDir, { recursive: true });
async function run(name, args) {
  const child = spawn('npm', ['run', 'test:e2e', '--', ...args], {
    env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logPath = join(evidenceDir, `${name}.log`);
  writeFileSync(logPath, '');
  child.stdout.on('data', (data) => appendFileSync(logPath, data));
  child.stderr.on('data', (data) => appendFileSync(logPath, data));
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', resolve);
  });
  assert.equal(code, 0, `${name} failed; inspect ${evidenceDir}/${name}.log`);
}
await Promise.all([run('full-suite', []), run('parallel-auth', ['auth-signup.spec.ts'])]);
const after = snapshot();
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => before[path] !== after[path]);
assert.deepEqual(changed, [], 'development files changed');
const reports = readdirSync('playwright-report').filter((name) => !runsBefore.has(name));
assert.equal(reports.length, 2, 'each invocation must retain its own report');
const stats = reports.map((name) => {
  const report = JSON.parse(readFileSync(join('playwright-report', name, 'results.json')));
  assert.equal(report.stats.unexpected, 0);
  assert.equal(existsSync(join('.playwright', name)), false, 'temporary run root was not removed');
  return { run: name, passed: report.stats.expected, failures: report.stats.unexpected };
});
console.log(JSON.stringify({ developmentFilesUnchanged: Object.keys(before).length, concurrentRuns: stats }, null, 2));
