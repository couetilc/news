export const PAGE_SIZE = 50;
export type Tab = 'unread' | 'read';
export function parseTab(raw: string | null): Tab {
	return raw === 'read' ? 'read' : 'unread';
}
export function isReadTab(tab: Tab): boolean {
	return tab === 'read';
}

// A position in the descending effective publication time / id ordering.
// Rows inserted or removed before this boundary cannot shift a later page.
export interface FeedCursor { time: number; id: number }
export function itemCursor(item: { id: number; published_at: number | null; fetched_at: number }): FeedCursor {
	return { time: item.published_at ?? item.fetched_at, id: item.id };
}
export function encodeCursor(cursor: FeedCursor): string {
	return JSON.stringify([cursor.time, cursor.id]);
}

// Missing means page one; malformed means a 400, never an unbounded SQL input.
// Bound dates to JavaScript's supported range and IDs to positive safe integers.
export function parseCursor(raw: string | null): FeedCursor | undefined | null {
	if (raw === null) return undefined;
	if (raw.length > 96) return null;
	try {
		const value: unknown = JSON.parse(raw);
		if (!Array.isArray(value) || value.length !== 2) return null;
		const [time, id] = value;
		if (typeof time !== 'number' || !Number.isFinite(time) || Math.abs(time) > 8.64e12 ||
			typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
		return { time, id };
	} catch { return null; }
}
