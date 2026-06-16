import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';

// The AWS What's New search API (aws.amazon.com/api/dirs/items/search) returns
// JSON, not a feed: a top-level `items` array where each element wraps the
// record under an `item` key. The record carries a stable `id` and an
// `additionalFields` object holding the editorial fields we want — `headline`,
// the full `postBody` HTML, `postDateTime` (ISO-8601), and a relative
// `headlineUrl`. We run one query per silicon term (graviton/trainium/…); the
// same launch can surface under several terms, but every copy shares the same
// `id`, so the (source, guid) dedupe in insertItems collapses them to one row.
const BASE_URL = 'https://aws.amazon.com';

interface AwsAdditionalFields {
	headline?: string;
	postBody?: string;
	postDateTime?: string;
	headlineUrl?: string;
}

interface AwsRecord {
	id?: string;
	additionalFields?: AwsAdditionalFields;
}

interface AwsSearchResponse {
	items?: { item?: AwsRecord }[];
}

function textOf(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

// headlineUrl is a site-relative path ("/about-aws/whats-new/..."); make it
// absolute. An already-absolute URL (http/https) is left as-is.
function absoluteUrl(path: string): string {
	return /^https?:\/\//.test(path) ? path : BASE_URL + path;
}

export function parseAwsWhatsNew(json: string): ParsedItem[] {
	// Treat un-parseable JSON or a non-object top level (e.g. JSON.parse("null")
	// yields null, on which `.items` would throw) as the documented rejection,
	// never an undocumented TypeError/SyntaxError on untrusted input (#165).
	let parsed: AwsSearchResponse;
	try {
		parsed = JSON.parse(json) as AwsSearchResponse;
	} catch {
		throw new Error('not an AWS What’s New response: invalid JSON');
	}
	if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.items)) {
		throw new Error('not an AWS What’s New response: missing items array');
	}

	const items: ParsedItem[] = [];
	for (const wrapper of parsed.items) {
		// A null/non-object array element has no `item` field; skip it rather than
		// dereferencing it (a malformed element must not crash the whole parse).
		const record = wrapper && typeof wrapper === 'object' ? wrapper.item : undefined;
		if (!record || typeof record !== 'object') continue;

		// No stable id means nothing to dedupe on across queries — skip it.
		const guid = textOf(record.id);
		if (!guid) continue;

		const fields = record.additionalFields ?? {};
		const headlineUrl = textOf(fields.headlineUrl);
		items.push({
			guid,
			url: headlineUrl ? absoluteUrl(headlineUrl) : guid,
			title: textOf(fields.headline) ?? '',
			// The What's New post body is the full announcement, not a teaser, so
			// it's the content; there's no separate summary field.
			summary: null,
			contentHtml: textOf(fields.postBody),
			publishedAt: parseRfc822(textOf(fields.postDateTime)),
		});
	}
	return items;
}
