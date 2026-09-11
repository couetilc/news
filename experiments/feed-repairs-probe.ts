// Read-only network verification, deliberately outside the hermetic tests.
// The remote-preview config has no routes, cron, secrets, or storage bindings.
import { SOURCES } from '../src/ingest/sources';

const REPAIRED = ['intel', 'owenomics', 'deepseek'];
export async function probe(source: string) {
	if (!REPAIRED.includes(source)) throw new Error('unknown probe source');
	const config = SOURCES.find((entry) => entry.source === source)!;
	const requests: { url: string; status: number; contentType: string | null }[] = [];
	const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
		const response = await fetch(url, init);
		requests.push({ url: String(url), status: response.status, contentType: response.headers.get('content-type') });
		return response;
	}) as typeof fetch;
	const init = {
		headers: { 'User-Agent': 'news.cuteteal.com aggregator (connor@couetil.com)' },
		signal: AbortSignal.timeout(30_000),
	};
	const response = config.fetch ? await config.fetch(fetchFn, init) : await fetchFn(config.feed, init);
	if (response.status !== 200) throw new Error(`${source}: HTTP ${response.status}`);
	const body = await response.text();
	const parsed = config.parse(body);
	const kept = config.keep ? parsed.filter(config.keep) : parsed;
	const unique = [...new Map(kept.map((item) => [item.url, item])).values()]
		.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
	if (parsed.length === 0 || unique.length === 0) throw new Error(`${source}: no articles`);
	return {
		checkedAt: new Date().toISOString(), source, requests,
		raw: config.countRaw!(body), parsed: parsed.length, kept: kept.length, unique: unique.length,
		missingTitles: parsed.filter((item) => !item.title).length,
		missingDates: parsed.filter((item) => item.publishedAt === null).length,
		latest: unique.slice(0, 5).map(({ title, url, publishedAt }) => ({ title, url, publishedAt })),
	};
}

export default {
	async fetch(request: Request) {
		try {
			return Response.json(await probe(new URL(request.url).searchParams.get('source') ?? ''));
		} catch (error) {
			return Response.json({ error: String(error) }, { status: 502 });
		}
	},
};
