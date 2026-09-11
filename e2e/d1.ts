import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { builtConfigPath, stateDir } from './runtime.mjs';

const WRANGLER = fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url));
const LOCAL_ARGS = ['--local', '--config', builtConfigPath, '--persist-to', stateDir];

function wrangler(args: string[]): string {
	return execFileSync(WRANGLER, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// The server and helpers share only this invocation's dedicated persistence.
export function d1Query<T = Record<string, unknown>>(sql: string): T[] {
	const out = wrangler(['d1', 'execute', 'NEWS_DB', ...LOCAL_ARGS, '--json', '--command', sql]);
	const parsed = JSON.parse(out) as Array<{ results: T[] }>;
	return parsed[0]?.results ?? [];
}

// One local binding proxy per Playwright worker avoids repeated CLI startup for
// resets. getPlatformProxy takes the v3 directory itself; CLI --persist-to and
// the Vite plugin take its parent. Remote resources are never enabled here.
let proxy: ReturnType<typeof getPlatformProxy<{ NEWS_DB: D1Database; SESSION: KVNamespace }>> | undefined;
function bindings() {
	return proxy ??= getPlatformProxy<{ NEWS_DB: D1Database; SESSION: KVNamespace }>({
		configPath: builtConfigPath,
		persist: { path: join(stateDir, 'v3') },
		remoteBindings: false,
	});
}

export async function disposeBindings(): Promise<void> {
	if (proxy) await (await proxy).dispose();
	proxy = undefined;
}

async function clearSessions(): Promise<void> {
	const { env } = await bindings();
	let cursor: string | undefined;
	do {
		const result = await env.SESSION.list({ cursor });
		await Promise.all(result.keys.map(({ name }) => env.SESSION.delete(name)));
		cursor = result.list_complete ? undefined : result.cursor;
	} while (cursor);
}

// IDs can be reused after DELETE: invalidate sessions and read history before
// users. The regression spec calls this inside a case to check stale cookies.
export async function resetUsers(): Promise<void> {
	await clearSessions();
	const { env } = await bindings();
	await env.NEWS_DB.batch([
		env.NEWS_DB.prepare('DELETE FROM item_reads'),
		env.NEWS_DB.prepare('DELETE FROM users'),
	]);
}

export async function resetTestState(): Promise<void> {
	await clearSessions();
	const { env } = await bindings();
	await env.NEWS_DB.batch([
		env.NEWS_DB.prepare('DELETE FROM item_reads'),
		env.NEWS_DB.prepare('DELETE FROM users'),
		env.NEWS_DB.prepare('DELETE FROM items'),
		env.NEWS_DB.prepare('DELETE FROM feeds'),
	]);
}
