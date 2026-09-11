// Read-only live probe. Run from the repo root; no D1 writes or credentials.
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
try {
	const { SOURCES } = await vite.ssrLoadModule('/src/ingest/sources.ts');
	const { fetchFeed, DEFAULT_POLL_LIMITS } = await vite.ssrLoadModule('/src/ingest/bounded-fetch.ts');
	const selected = new Set(['openai', 'open-models', 'intel', 'deepseek', 'owenomics']);
	const results = await Promise.all(SOURCES.filter(config => selected.has(config.source)).map(async (config) => {
		const start = Date.now();
		let responseStatus = null;
		try {
			const response = await fetchFeed(config, fetch, { headers: { 'User-Agent': 'news.cuteteal.com aggregator (connor@couetil.com)' } }, DEFAULT_POLL_LIMITS, status => { responseStatus = status; });
			return { source: config.source, status: response.status, bytes: new TextEncoder().encode(response.body).byteLength, items: response.status === 200 ? config.parse(response.body).length : 0, elapsedMs: Date.now() - start };
		}
		catch (error) {
			return { source: config.source, status: responseStatus, error: String(error).slice(0, 300), elapsedMs: Date.now() - start };
		}
	}));
	console.log(JSON.stringify({ checkedAt: new Date().toISOString(), limits: DEFAULT_POLL_LIMITS, results }, null, 2));
}
finally {
	await vite.close();
}
