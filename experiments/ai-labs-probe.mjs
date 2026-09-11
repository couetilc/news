// Read-only live audit: node experiments/ai-labs-probe.mjs
// Uses the production transport limits, User-Agent, configuration, parsers and
// validation. This verifies the current machine's fetch path, not Cloudflare's
// egress IPs; confirm the first scheduled production poll separately.
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
try {
  const { AI_LAB_SOURCES } = await vite.ssrLoadModule('/src/ingest/ai-lab-sources.ts');
  const { fetchFeed, DEFAULT_POLL_LIMITS } = await vite.ssrLoadModule('/src/ingest/bounded-fetch.ts');
  const { validateParse } = await vite.ssrLoadModule('/src/ingest/validate.ts');
  const results = await Promise.all(AI_LAB_SOURCES.map(async (config) => {
    try {
      const response = await fetchFeed(config, fetch, {
        headers: { 'User-Agent': 'news.cuteteal.com aggregator (connor@couetil.com)' },
      }, DEFAULT_POLL_LIMITS, () => {});
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      const items = config.parse(response.body);
      const rawCount = config.countRaw(response.body);
      const kept = items.filter(config.keep);
      const anomaly = validateParse({ rawCount, items });
      if (anomaly) process.exitCode = 1;
      return { source: config.source, feed: config.feed, status: response.status, rawCount, parsed: items.length,
        kept: kept.length, unique: new Set(kept.map((item) => item.url)).size, anomaly };
    } catch (error) {
      process.exitCode = 1;
      return { source: config.source, error: error.message };
    }
  }));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), fetchPath: 'native laptop', results }, null, 2));
} finally {
  await vite.close();
}
