import { describe, expect, it } from 'vitest';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guard for the shared agent instruction layer (#83): Claude reads CLAUDE.md,
// Codex reads AGENTS.md, and AGENTS.md is a symlink to CLAUDE.md so the two can
// never drift. Edit CLAUDE.md (the canonical file); AGENTS.md follows
// automatically. This test fails if the symlink is ever replaced by a divergent
// copy.
const repoPath = (file: string) => fileURLToPath(new URL(`../${file}`, import.meta.url));

describe('shared agent instruction layer', () => {
	it('AGENTS.md is a symlink pointing at CLAUDE.md', () => {
		expect(lstatSync(repoPath('AGENTS.md')).isSymbolicLink()).toBe(true);
		expect(readlinkSync(repoPath('AGENTS.md'))).toBe('CLAUDE.md');
	});

	it('Codex and Claude therefore read byte-for-byte identical instructions', () => {
		expect(readFileSync(repoPath('AGENTS.md'), 'utf8')).toBe(
			readFileSync(repoPath('CLAUDE.md'), 'utf8'),
		);
	});
});
