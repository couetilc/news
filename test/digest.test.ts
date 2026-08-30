import { describe, expect, it } from 'vitest';
import {
	activeSourceFilter,
	emptyMessage,
	feedReturnTo,
	orderSourcesByName,
	pickSectionTotal,
	showRecentlyViewed,
} from '../src/lib/digest';

// Example tests for the pure digest-assembly decisions (#349) extracted from
// index.astro / feed.astro / db.ts. The invariants across generated inputs
// live in test/digest.prop.test.ts; the pages' render tests (index/feed) prove
// the templates execute these decisions. Plain node — in Stryker's scope.

describe('activeSourceFilter', () => {
	it('keeps only present slugs, in request order, dropping junk silently', () => {
		expect(activeSourceFilter(['cf', 'nope', 'aws'], ['aws', 'cf'])).toEqual(['cf', 'aws']);
	});

	it('empty request or nothing present → [] (meaning "All", never a 500)', () => {
		expect(activeSourceFilter([], ['aws'])).toEqual([]);
		expect(activeSourceFilter(['aws'], [])).toEqual([]);
	});
});

describe('orderSourcesByName', () => {
	it('orders slugs by display NAME (via the registry), not by slug', () => {
		// Slug order would put 'ti' after 'cloudflare-blog'; name order is
		// AWS < Cloudflare Blog < Texas Instruments.
		expect(orderSourcesByName(['ti', 'cloudflare-blog', 'aws'])).toEqual([
			'aws',
			'cloudflare-blog',
			'ti',
		]);
	});

	it('an unregistered slug sorts by its raw-slug fallback name and never crashes', () => {
		expect(orderSourcesByName(['zzz-unknown', 'aws'])).toEqual(['aws', 'zzz-unknown']);
	});

	it('does not mutate its input', () => {
		const slugs = ['ti', 'aws'];
		orderSourcesByName(slugs);
		expect(slugs).toEqual(['ti', 'aws']);
	});
});

describe('pickSectionTotal', () => {
	it('the Read tab scrolls against the read total, Unread against unread', () => {
		expect(pickSectionTotal('read', 7, 3)).toBe(3);
		expect(pickSectionTotal('unread', 7, 3)).toBe(7);
	});
});

describe('showRecentlyViewed (#334)', () => {
	it('renders only for a logged-in reader on the Unread tab', () => {
		expect(showRecentlyViewed(true, 'unread')).toBe(true);
		expect(showRecentlyViewed(true, 'read')).toBe(false);
		expect(showRecentlyViewed(false, 'unread')).toBe(false);
		expect(showRecentlyViewed(false, 'read')).toBe(false);
	});
});

describe('emptyMessage', () => {
	it('maps tab × filtered to the four exact copy strings', () => {
		expect(emptyMessage('unread', false)).toBe('All caught up — nothing unread.');
		expect(emptyMessage('unread', true)).toBe('Nothing unread from this source.');
		expect(emptyMessage('read', false)).toBe('Nothing read yet.');
		expect(emptyMessage('read', true)).toBe('Nothing read from this source yet.');
	});
});

describe('feedReturnTo (#80)', () => {
	it('returns to the top of the active tab, carrying the filter, dropping the offset', () => {
		expect(feedReturnTo('unread', [])).toBe('/?tab=unread');
		expect(feedReturnTo('read', ['aws', 'cf'])).toBe('/?tab=read&source=aws&source=cf');
	});
});
