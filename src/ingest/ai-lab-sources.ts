import type { FeedConfig, ParsedItem } from './types';
import { parseRss20 } from './parse/rss20';
import { parseAtom } from './parse/atom';
import { countAtom, countRss20 } from './parse/count';
import { countLiquid, countNormal, countPhysicalIntelligence, countWorldLabs, countXai, parseLiquid, parseNormal, parsePhysicalIntelligence, parseWorldLabs, parseXai } from './parse/ai-labs';
import { countExtropic, parseExtropic } from './parse/extropic';
import { articleUrl } from './parse/lab-html';

const AUGUST = Date.UTC(2026, 7, 1) / 1000;
const JULY = Date.UTC(2026, 6, 1) / 1000;
const JUNE = Date.UTC(2026, 5, 1) / 1000;
const JANUARY = Date.UTC(2026, 0, 1) / 1000;
// Fixed launch cutoffs bound the first backfill without aging out future posts.
// RSS/Atom dates can legitimately be absent; keep those rather than silently
// losing a release. Custom dated listings reject missing dates at parse time.
const since = (item: ParsedItem, cutoff: number) => item.publishedAt === null || item.publishedAt >= cutoff;
const COMPANY_NEWS = /\b(funding|fundraise|raises?|appoints?|hiring)\b/i;

// Exactly the ten selections approved in #398. Model/research channels poll
// every six hours; the three low-volume hardware channels poll daily.
export const AI_LAB_SOURCES: FeedConfig[] = [
	{
		source: 'deepmind', feed: 'https://deepmind.google/blog/rss.xml', pollIntervalSeconds: 21600,
		parse: (xml) => parseRss20(xml, { content: 'content:encoded' }), countRaw: countRss20,
		keep: (item) => since(item, AUGUST),
	},
	{
		source: 'ai2', feed: 'https://allenai.org/rss.xml', pollIntervalSeconds: 21600,
		parse: (xml) => parseRss20(xml, { content: 'content:encoded' }), countRaw: countRss20,
		keep: (item) => since(item, AUGUST),
	},
	{
		source: 'liquid-ai', feed: 'https://www.liquid.ai/news/models', pollIntervalSeconds: 21600,
		parse: parseLiquid, countRaw: countLiquid, keep: (item) => since(item, AUGUST),
	},
	{
		source: 'sakana-ai', feed: 'https://sakana.ai/feed.xml', pollIntervalSeconds: 21600,
		// Sakana's advertised Atom feed uses relative alternate links.
		parse: (xml) => parseAtom(xml, { content: 'content' }).map((item) => ({ ...item, url: articleUrl(item.url, 'https://sakana.ai') })), countRaw: countAtom,
		keep: (item) => since(item, AUGUST) && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(item.title)
			&& !/\b(partnership|investment)\b/i.test(item.title) && !COMPANY_NEWS.test(item.title),
	},
	{
		source: 'extropic', feed: 'https://extropic.ai/writing', pollIntervalSeconds: 86400,
		parse: parseExtropic, countRaw: countExtropic, keep: (item) => since(item, JULY),
	},
	{
		source: 'normal-computing', feed: 'https://www.normalcomputing.com/blog', pollIntervalSeconds: 86400,
		parse: parseNormal, countRaw: countNormal,
		keep: (item) => since(item, JUNE) && /\b(thermodynamic|stochastic|hardware|CN\d+|analog|inference)\b/i.test(item.title) && !COMPANY_NEWS.test(item.title),
	},
	{
		source: 'mythic', feed: 'https://www.mythic.ai/newsroom?format=rss', pollIntervalSeconds: 86400,
		parse: (xml) => parseRss20(xml, { content: 'content:encoded' }), countRaw: countRss20,
		keep: (item) => since(item, JANUARY) && !COMPANY_NEWS.test(item.title),
	},
	{
		// Main news HTTP is blocked; these are first-party model/voice/API notes.
		// The parser bounds the listing to the newest three monthly sections.
		source: 'xai', feed: 'https://docs.x.ai/developers/release-notes', pollIntervalSeconds: 21600,
		parse: parseXai, countRaw: countXai,
		keep: (item) => /\b(grok|imagine|voice|speech|stt|tts)\b/i.test(item.title) && !/\bavailable in the EU\b/i.test(item.title),
	},
	{
		source: 'physical-intelligence', feed: 'https://www.pi.website/blog', pollIntervalSeconds: 21600,
		parse: parsePhysicalIntelligence, countRaw: countPhysicalIntelligence,
		keep: (item) => since(item, JANUARY) && !/\bpartnership\b/i.test(item.title),
	},
	{
		source: 'world-labs', feed: 'https://www.worldlabs.ai/blog', pollIntervalSeconds: 21600,
		parse: parseWorldLabs, countRaw: countWorldLabs,
		keep: (item) => since(item, JUNE) && !COMPANY_NEWS.test(item.title) && !/\bWorld Labs Acquires\b/i.test(item.title),
	},
];
