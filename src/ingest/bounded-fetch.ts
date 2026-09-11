import type { FeedConfig } from './types';
// Decoded body bytes: ample headroom over the largest measured active archive
// (723,198 bytes, OpenAI). One deadline covers headers, streaming, and custom loaders.
export const DEFAULT_POLL_LIMITS = { timeoutMs: 20_000, maxBytes: 8 * 1024 * 1024 };
export interface PollLimits {
	timeoutMs: number;
	maxBytes: number;
}

export interface FeedResponse {
	status: number;
	headers: Headers;
	body: string;
}

export async function fetchFeed(
	config: FeedConfig,
	fetchFn: typeof fetch,
	init: RequestInit,
	limits: PollLimits,
	onResponse: (status: number) => void,
): Promise<FeedResponse> {
	const controller = new AbortController();
	const timeout = new Error(`feed deadline exceeded (${limits.timeoutMs}ms)`);
	let rejectDeadline!: (error: Error) => void;
	const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
	const timer = setTimeout(() => { controller.abort(); rejectDeadline(timeout); }, limits.timeoutMs);
	const race = <T>(work: Promise<T>): Promise<T> => Promise.race([work, deadline]);
	const cancel = (body: ReadableStream<Uint8Array> | null): void => {
		if (body)
			void body.cancel().catch(() => { });
	};
	async function read(response: Response): Promise<Uint8Array<ArrayBuffer>> {
		if (!response.body)
			return new Uint8Array();
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const { done, value } = await race(reader.read());
				if (done)
					break;
				size += value.byteLength;
				if (size > limits.maxBytes)
					throw new Error(`feed body exceeds ${limits.maxBytes} bytes`);
				chunks.push(value);
			}
		}
		catch (error) {
			// A malicious stream can leave cancel() pending forever. Do not await it.
			void reader.cancel().catch(() => { });
			throw error;
		}
		finally {
			reader.releaseLock();
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return bytes;
	}
	const bounded = (async (input: RequestInfo | URL, request?: RequestInit) => {
		const pending = fetchFn(input, { ...request, signal: controller.signal }).then((response) => {
			// Even a fetch fake or upstream that ignores AbortSignal may finish late.
			if (controller.signal.aborted) {
				cancel(response.body);
				throw timeout;
			}
			onResponse(response.status);
			return response;
		});
		const response = await race(pending);
		if (response.status !== 200) {
			cancel(response.body);
			return new Response(null, { status: response.status, headers: response.headers });
		}
		const bytes = await read(response);
		// Custom loaders may call json()/text() on intermediate responses; provide
		// only an already bounded body, under the shared end-to-end deadline.
		return new Response(bytes, { status: response.status, headers: response.headers });
	}) as typeof fetch;
	try {
		const response = await race(config.fetch ? config.fetch(bounded, { ...init, signal: controller.signal }) : bounded(config.feed, init));
		if (response.status !== 200) {
			cancel(response.body);
			return { status: response.status, headers: response.headers, body: '' };
		}
		return { status: response.status, headers: response.headers, body: new TextDecoder().decode(await read(response)) };
	}
	finally {
		clearTimeout(timer);
		controller.abort();
	}
}
