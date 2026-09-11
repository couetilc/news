// Read-only live probe, outside the hermetic test suite:
//   node experiments/verify-meta-ai.mjs
// Uses the production parser; prints only public feed metadata, never tokens.
import { createServer } from 'vite';

const vite = await createServer({
	configFile: false,
	server: { middlewareMode: true },
	logLevel: 'silent',
});
try {
	const { parseMetaAiResearch } = await vite.ssrLoadModule('/src/ingest/parse/meta-ai.ts');
	const { countMetaAiResearch } = await vite.ssrLoadModule('/src/ingest/parse/count.ts');
	const response = await fetch('https://research.meta.ai/', {
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) throw new Error(`Meta listing returned HTTP ${response.status}`);
	const html = await response.text();
	const items = parseMetaAiResearch(html);
	if (items.length === 0) throw new Error('Meta listing parsed no articles');
	console.log(JSON.stringify({
		checkedAt: new Date().toISOString(),
		url: response.url,
		status: response.status,
		rawArticles: countMetaAiResearch(html),
		parsedArticles: items.length,
		missingTitles: items.filter((item) => !item.title).length,
		missingDates: items.filter((item) => item.publishedAt === null).length,
		museVoiceTranscribe: items.find((item) => item.url.endsWith('/introducing-muse-voice-transcribe')) ?? null,
	}, null, 2));
} finally {
	await vite.close();
}
