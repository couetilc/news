import { handle } from '@astrojs/cloudflare/handler';
import { ingestAll } from './ingest/run';
import { SOURCES } from './ingest/sources';

// Custom Worker entry (wrangler.jsonc `main`): the Astro fetch handler plus a
// scheduled handler driven by the cron trigger. The cron fires every 15 min;
// ingestAll only polls feeds whose own cadence is due.
export default {
	fetch: handle,
	async scheduled(_controller, env, _ctx) {
		await ingestAll(
			{ db: env.NEWS_DB, fetchFn: fetch, now: () => Math.floor(Date.now() / 1000) },
			SOURCES,
		);
	},
} satisfies ExportedHandler<Env>;
