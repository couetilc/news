// Negative controls: demonstrate that each runtime/template check catches errors.
// Temporary probes are always removed; run from the repository root.
import { writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const probes = [
  {
    files: { 'src/lib/__401_probe.ts': 'export const forbidden = document.createElement("div");' },
    command: ['tsc', '-p', 'tsconfig.worker.json'],
    expected: ['Cannot find name \'document\''],
  },
  {
    files: { 'src/scripts/__401_probe.ts': 'export const forbidden: D1Database = {};' },
    command: ['tsc', '-p', 'tsconfig.browser.json'],
    expected: ['Cannot find name \'D1Database\''],
  },
  {
    files: {
      'src/components/__401_Probe.astro': '---\nconst bad: number = "template probe";\n---\n<p>{bad}</p>',
      'test/__401_probe.test.ts': 'export const bad: number = "node probe";',
    },
    command: ['astro', 'check', '--minimumSeverity', 'error'],
    expected: ['src/components/__401_Probe.astro', 'test/__401_probe.test.ts'],
  },
];
for (const probe of probes) {
  const created = [];
  try {
    for (const [path, body] of Object.entries(probe.files)) { writeFileSync(path, body, { flag: 'wx' }); created.push(path); }
    const result = spawnSync(`node_modules/.bin/${probe.command[0]}`, probe.command.slice(1), { encoding: 'utf8' });
    assert.ok(result.status !== null && result.status !== 0);
    for (const expected of probe.expected) assert.ok(result.stdout.includes(expected), result.stdout + result.stderr);
    console.log(`Confirmed rejection: ${Object.keys(probe.files).join(', ')}`);
  } finally {
    for (const path of created) unlinkSync(path);
  }
}
