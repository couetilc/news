import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from '../src/lib/email';

// The Resend send helper (#88) is unit-tested with `fetch` injected/mocked, so
// `npm test` never hits the network. These cases pin the request shape the
// Resend API expects (URL, POST, Bearer auth, JSON body) and both outcomes: a
// 2xx returns the message id; a non-2xx throws with the response detail.

afterEach(() => {
	vi.restoreAllMocks();
});

const params = {
	to: 'connor@couetil.com',
	subject: 'Your magic link',
	text: 'plain body',
	html: '<p>rich body</p>',
};

const deps = {
	apiKey: 're_test_key',
	from: 'News <noreply@news.cuteteal.com>',
};

describe('sendEmail', () => {
	it('POSTs the Resend API with bearer auth and a JSON body, returning the id', async () => {
		const fetchFn = vi.fn(async () =>
			new Response(JSON.stringify({ id: 'abc-123' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		) as unknown as typeof fetch;

		const result = await sendEmail({ ...deps, fetchFn }, params);

		expect(result).toEqual({ id: 'abc-123' });

		const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
		expect(mock).toHaveBeenCalledTimes(1);
		const [url, init] = mock.mock.calls[0];
		expect(url).toBe('https://api.resend.com/emails');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({
			Authorization: 'Bearer re_test_key',
			'Content-Type': 'application/json',
		});
		// Body is the JSON-serialized envelope, carrying from + every param field.
		expect(JSON.parse(init.body)).toEqual({
			from: 'News <noreply@news.cuteteal.com>',
			to: 'connor@couetil.com',
			subject: 'Your magic link',
			text: 'plain body',
			html: '<p>rich body</p>',
		});
	});

	it('defaults to the global fetch when none is injected', async () => {
		const spy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(
				new Response(JSON.stringify({ id: 'global-1' }), { status: 200 }),
			);

		const result = await sendEmail(deps, params);

		expect(result).toEqual({ id: 'global-1' });
		expect(spy).toHaveBeenCalledWith('https://api.resend.com/emails', expect.any(Object));
	});

	it('throws with the status and body on a non-2xx response', async () => {
		const fetchFn = vi.fn(async () =>
			new Response(JSON.stringify({ name: 'validation_error', message: 'bad from' }), {
				status: 422,
			}),
		) as unknown as typeof fetch;

		await expect(sendEmail({ ...deps, fetchFn }, params)).rejects.toThrow(
			/Resend send failed \(422\):.*bad from/,
		);
	});
});
