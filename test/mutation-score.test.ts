import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function score(contents?: string) {
	const dir = mkdtempSync(join(tmpdir(), 'news-mutation-report-'));
	try {
		const report = join(dir, 'report.json');
		if (contents !== undefined) writeFileSync(report, contents);
		return spawnSync(process.execPath, ['scripts/mutation-score.mjs', report], { encoding: 'utf8' });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
const report = (...statuses: string[]) => JSON.stringify({ files: { 'src/example.ts': { mutants: statuses.map((status) => ({ status })) } } });

describe('advisory mutation report validation', () => {
	it('reports survivors and uncovered mutants without failing on a low score', () => {
		const result = score(report('Survived', 'NoCoverage'));
		expect(result.status).toBe(0);
		expect(result.stdout).toBe('0.00');
	});
	it('uses measured mutants as the denominator, including timeouts as detected', () => {
		const result = score(report('Killed', 'Timeout', 'Survived', 'NoCoverage', 'CompileError', 'RuntimeError', 'Ignored'));
		expect(result.status).toBe(0);
		expect(result.stdout).toBe('50.00');
	});
	it.each([undefined, '{', '{}', '{"files":[]}', '{"files":{"x":null}}', '{"files":{"x":{"mutants":[null]}}}', report(), report('CompileError'), report('Pending'), report('unknown')])('fails missing, invalid or incomplete report %s', (contents) => {
		const result = score(contents);
		expect(result.status).toBe(1);
		expect(result.stdout).toBe('');
		expect(result.stderr).toContain('Invalid mutation report:');
	});
});
