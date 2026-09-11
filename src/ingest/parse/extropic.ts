import { article, document, elements, formatError } from './lab-html';

function json(value: string): unknown {
	try { return JSON.parse(value); } catch { return null; }
}

// Next's Flight transport embeds JSON strings in push calls. Decode data only;
// never eval JavaScript or resolve arbitrary runtime references. The writing
// response includes the actual referenced post objects in other records.
function posts(html: string): Record<string, unknown>[] {
	const result: Record<string, unknown>[] = [];
	for (const script of elements(document(html), (n) => n.name === 'script')) {
		const body = script.children.filter((n) => n.type === 'text').map((n) => n.data).join('').trim();
		const call = /^self\.__next_f\.push\(([\s\S]*)\);?$/.exec(body);
		if (!call) continue;
		const payload = json(call[1]);
		if (!Array.isArray(payload) || typeof payload[1] !== 'string') continue;
		for (const line of payload[1].split('\n')) {
			const stack: unknown[] = [json(line.slice(line.indexOf(':') + 1))];
			while (stack.length) {
				const value = stack.pop();
				if (value === null || typeof value !== 'object') continue;
				const object = value as Record<string, unknown>;
				// The page-wide CMS inventory also contains partial, undated copies.
				// Only rendered listing props have totalCount or featuredPosts.
				const cards = object.featuredPosts ?? ('totalCount' in object ? object.posts : null);
				if (Array.isArray(cards)) {
					for (const card of cards) {
						if (card !== null && typeof card === 'object' && ['post', 'manualPost', 'research'].includes(card._type)) result.push(card);
					}
				}
				// Iterative walk, including arrays. Media, investors, palette metadata
				// and Flight reference strings aren't article records.
				for (const child of Object.values(object)) stack.push(child);
			}
		}
	}
	return result;
}

export function countExtropic(html: string): number {
	try { return posts(html).length; } catch { return 0; }
}

export function parseExtropic(html: string) {
	const records = posts(html);
	if (!records.length) throw formatError();
	return records.map((post) => article(
		typeof post.url === 'string' ? post.url : typeof post.slug === 'string' ? `/writing/${post.slug}` : undefined,
		typeof post.title === 'string' ? post.title.trim() : '',
		typeof post.publishDate === 'string' ? post.publishDate : '',
		'https://extropic.ai',
	));
}
