import { afterEach, expect, it, vi } from 'vitest';
import { fetchFeed, DEFAULT_POLL_LIMITS } from '../src/ingest/bounded-fetch';
import type { FeedConfig } from '../src/ingest/types';
const config: FeedConfig = { source: 'test', feed: 'https://example.com/feed', pollIntervalSeconds: 3600, parse: () => [] };
const limits = { timeoutMs: 100, maxBytes: 8 };
const status = vi.fn();
const load = (fetchFn: typeof fetch, custom: Partial<FeedConfig> = {}) => fetchFeed({ ...config, ...custom }, fetchFn, { headers: { 'If-None-Match': 'v1' } }, limits, status);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('has finite defaults with headroom for measured archives', () => { expect(DEFAULT_POLL_LIMITS).toEqual({ timeoutMs: 20000, maxBytes: 8388608 }); });
it('preserves UTF-8 across chunks and conditional headers, and releases the reader', async () => {
	const bytes = new TextEncoder().encode('a🙂b');
	const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 3)); c.enqueue(bytes.slice(3)); c.close(); } });
	const fn = vi.fn(async (_input, init) => { expect(new Headers(init.headers).get('If-None-Match')).toBe('v1'); expect(init.signal).toBeInstanceOf(AbortSignal); return new Response(body, { headers: { etag: 'v2' } }); }) as typeof fetch;
	const result = await load(fn);
	expect(result.body).toBe('a🙂b');
	expect(result.headers.get('etag')).toBe('v2');
	expect(status).toHaveBeenCalledWith(200);
	expect(body.locked).toBe(false);
});
it('does not trust Content-Length and cancels an oversized decoded stream', async () => {
	const cancelled = vi.fn();
	const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(9)); }, cancel: cancelled });
	await expect(load((async () => new Response(body, { headers: { 'Content-Length': '1' } })) as typeof fetch)).rejects.toThrow('exceeds 8 bytes');
	expect(cancelled).toHaveBeenCalledOnce();
	expect(body.locked).toBe(false);
});
it('cancels non200 without reading a stalled body', async () => {
	const cancelled = vi.fn(() => new Promise<void>(() => { }));
	const body = new ReadableStream({ cancel: cancelled });
	const result = await load((async () => new Response(body, { status: 503 })) as typeof fetch);
	expect(result.status).toBe(503);
	expect(result.body).toBe('');
	expect(cancelled).toHaveBeenCalledOnce();
});
it('accepts304 and empty200 responses without bodies', async () => {
	expect((await load((async () => new Response(null, { status: 304 })) as typeof fetch)).status).toBe(304);
	expect((await load((async () => new Response(null)) as typeof fetch)).body).toBe('');
});
it('times out headers even when fetch ignores its abort signal and cancels a late body', async () => {
	vi.useFakeTimers();
	let finish!: (response: Response) => void;
	const cancel = vi.fn();
	const result = load((() => new Promise(resolve => { finish = resolve; })) as typeof fetch);
	const rejected = expect(result).rejects.toThrow('deadline exceeded');
	await vi.advanceTimersByTimeAsync(100);
	await rejected;
	finish(new Response(new ReadableStream({ cancel })));
	await vi.runAllTimersAsync();
	expect(cancel).toHaveBeenCalledOnce();
});
it('times out a stalled body without awaiting stuck cancellation', async () => {
	vi.useFakeTimers();
	const cancel = vi.fn(() => new Promise<void>(() => { }));
	const body = new ReadableStream<Uint8Array>({ cancel });
	const result = load((async () => new Response(body)) as typeof fetch);
	const rejected = expect(result).rejects.toThrow('deadline exceeded');
	await vi.advanceTimersByTimeAsync(100);
	await rejected;
	expect(cancel).toHaveBeenCalledOnce();
	expect(body.locked).toBe(false);
});
it('bounds both JSON bodies and the total custom-loader duration', async () => {
	vi.useFakeTimers();
	let calls = 0;
	const fn = (async () => { calls++; await new Promise(r => setTimeout(r, 60)); return new Response('{}'); }) as typeof fetch;
	const result = load(fn, { fetch: async (f, init) => { await (await f('https://one.test', init)).json(); await (await f('https://two.test', init)).json(); return new Response('{}'); } });
	const rejected = expect(result).rejects.toThrow('deadline exceeded');
	await vi.advanceTimersByTimeAsync(100);
	await rejected;
	expect(calls).toBe(2);
	await vi.advanceTimersByTimeAsync(50);
});
it('bounds custom output and intermediate JSON independently', async () => {
	await expect(load((async () => new Response('123456789')) as typeof fetch, { fetch: async (f, init) => { await (await f('https://one.test', init)).json(); return new Response('{}'); } })).rejects.toThrow('exceeds 8 bytes');
	await expect(load(vi.fn() as unknown as typeof fetch, { fetch: async () => new Response('123456789') })).rejects.toThrow('exceeds 8 bytes');
});
it('propagates cancellation rejection without an unhandled promise', async () => {
	const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(9)); }, cancel() { throw new Error('cancel failed'); } });
	await expect(load((async () => new Response(body)) as typeof fetch)).rejects.toThrow('exceeds 8 bytes');
	const bad = new ReadableStream({ cancel() { throw new Error('cancel failed'); } });
	expect((await load((async () => new Response(bad, { status: 500 })) as typeof fetch)).status).toBe(500);
});
it('bounds the actual Owenomics loader second JSON response before it can consume it', async () => {
	const { fetchOwenomics } = await import('../src/ingest/fetch/owenomics');
	let calls = 0;
	const cancelled = vi.fn();
	const fn = (async () => {
		calls++;
		return calls === 1
			? Response.json({ content: [{ sc_item_id: 'x' }] })
			: new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(65)); }, cancel: cancelled }));
	}) as typeof fetch;
	await expect(fetchFeed({ ...config, fetch: fetchOwenomics }, fn, {}, { timeoutMs: 100, maxBytes: 64 }, status)).rejects.toThrow('exceeds 64 bytes');
	expect(calls).toBe(2);
	expect(cancelled).toHaveBeenCalledOnce();
});
it('accepts a decoded body exactly at the byte ceiling', async () => {
	expect((await load((async () => new Response('12345678')) as typeof fetch)).body).toBe('12345678');
});

it('preserves conditional headers for a custom loader and releases its signal and timer when done', async () => {
	vi.useFakeTimers();
	let signal: AbortSignal | undefined;
	await load((async () => new Response('{}')) as typeof fetch, {
		fetch: async (transport, init) => {
			expect(new Headers(init.headers).get('If-None-Match')).toBe('v1');
			signal = init.signal as AbortSignal;
			expect(signal.aborted).toBe(false);
			return transport('https://custom.test', init);
		},
	});
	expect(signal!.aborted).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
});

it('cancels a custom loader non200 body without consuming its stalled stream', async () => {
	const cancel = vi.fn(() => new Promise<void>(() => {}));
	const result = await load(vi.fn() as unknown as typeof fetch, {
		fetch: async () => new Response(new ReadableStream({ cancel }), { status: 502 }),
	});
	expect(result).toMatchObject({ status: 502, body: '' });
	expect(cancel).toHaveBeenCalledOnce();
});
