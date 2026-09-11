// The public client context and search configuration are published in Acadian's
// frontend JS. They select its public search index, not a private account.
const SEARCH = 'https://edge-platform.sitecorecloud.io/v1/search';
const URLS = 'https://www.acadian-asset.com/api/search';
const CLIENT_CONTEXT = '5uvPpGUtTjhtpc9vlYj9uI';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const QUERY = {
	config: { id: '616d1de2-3d2d-4124-bb20-d4ffb3d3ea93' }, limit: 20, offset: 0,
	query: { keyphrase: '' }, sessionId: '', sort: { fields: [{ name: 'listingDate', order: 'desc' }] },
	facet: { all: true, fields: [
		{ name: 'Search Site', filters: [{ operator: 'eq', value: ['Acadian', 'Shared'] }] },
		{ name: 'Exclude From Search', filters: [{ operator: 'ne', value: true }] },
		{ name: 'Search Asset Type', filters: [{ operator: 'eq', value: ['Owenomics'] }] },
		{ name: 'Search Topic', filters: [{ operator: 'eq', value: ['Owenomics'] }] },
	] },
};

function content(value: unknown): Record<string, unknown>[] {
	if (!value || typeof value !== 'object' || !Array.isArray((value as { content?: unknown }).content)) {
		throw new Error('not an Owenomics search response: missing content array');
	}
	return (value as { content: unknown[] }).content.map((record) =>
		record && typeof record === 'object' ? record as Record<string, unknown> : {},
	);
}

// Acadian's new listing does two public POSTs: search returns titles/dates and
// item IDs; /api/search resolves those IDs to canonical article paths. Normalize
// that pair to the existing pure parser contract, preserving month precision
// and URL identities. Every request goes through the injected fetch boundary;
// the caller's headers and AbortSignal apply to both requests.
export async function fetchOwenomics(fetchFn: typeof fetch, init: RequestInit): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set('Content-Type', 'application/json');
	const searchHeaders = new Headers(headers);
	searchHeaders.set('x-sitecore-contextid', CLIENT_CONTEXT);
	const search = await fetchFn(SEARCH, { ...init, method: 'POST', headers: searchHeaders, body: JSON.stringify(QUERY) });
	if (search.status !== 200) return search;
	const records = content(await search.json());
	const response = await fetchFn(URLS, { ...init, method: 'POST', headers, body: JSON.stringify({
		content: records.filter((record) => typeof record.sc_item_id === 'string').map((record) => ({ sc_item_id: record.sc_item_id })),
	}) });
	if (response.status !== 200) return response;
	const urls = new Map(content(await response.json()).map((record) => [record.sc_item_id, record.url]));
	const results = records.map((record) => {
		const date = typeof record.listingDate === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])-/.exec(record.listingDate) : null;
		const url = typeof record.sc_item_id === 'string' ? urls.get(record.sc_item_id) : null;
		return {
			Title: record.navigationTitle,
			Url: typeof url === 'string' && /^\/(?:au\/)?investment-insights\/owenomics\/[^/?#]+$/.test(url) ? url : null,
			Date: date ? `${MONTHS[Number(date[2]) - 1]} ${date[1]}` : null,
		};
	});
	return Response.json({ Results: results });
}
