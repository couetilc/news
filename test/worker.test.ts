import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

// The real handler imports build-time virtual modules that don't exist in the
// test pipeline; the ingest run is exercised in run.test.ts. Here we only
// verify the entry wires both together.
vi.mock('@astrojs/cloudflare/handler', () => ({ handle: vi.fn() }));
vi.mock('../src/ingest/run', () => ({ ingestAll: vi.fn() }));

import { handle } from '@astrojs/cloudflare/handler';
import { ingestAll } from '../src/ingest/run';
import { SOURCES } from '../src/ingest/sources';
import worker from '../src/worker';

describe('worker entry', () => {
	it('serves fetch via the Astro adapter handler', () => {
		expect(worker.fetch).toBe(handle);
	});

	it('runs the ingest pipeline over SOURCES on the scheduled trigger', async () => {
		await worker.scheduled!(
			{} as ScheduledController,
			{ NEWS_DB: env.NEWS_DB } as Env,
			{} as ExecutionContext,
		);

		expect(ingestAll).toHaveBeenCalledTimes(1);
		const [deps, sources] = vi.mocked(ingestAll).mock.calls[0];
		expect(deps.db).toBe(env.NEWS_DB);
		expect(sources).toBe(SOURCES);
		expect(typeof deps.fetchFn).toBe('function');
		expect(typeof deps.now()).toBe('number');
	});
});
