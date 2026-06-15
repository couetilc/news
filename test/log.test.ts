import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../src/lib/log';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('structured log helper', () => {
	it('routes info records to console.log as an object (not a string)', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

		log.info('ingest.poll', { source: 'cf', status: 200, items: 2 });

		expect(spy).toHaveBeenCalledTimes(1);
		const [record] = spy.mock.calls[0];
		// An object is passed straight through so Workers Logs indexes its fields.
		expect(record).toEqual({
			level: 'info',
			event: 'ingest.poll',
			source: 'cf',
			status: 200,
			items: 2,
		});
		expect(typeof record).toBe('object');
	});

	it('routes error records to console.error with the level field set', () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		log.error('ingest.error', { source: 'cf', err: 'boom' });

		expect(logSpy).not.toHaveBeenCalled();
		expect(errSpy).toHaveBeenCalledTimes(1);
		expect(errSpy.mock.calls[0][0]).toEqual({
			level: 'error',
			event: 'ingest.error',
			source: 'cf',
			err: 'boom',
		});
	});

	it('defaults fields to empty so an event name alone is a valid record', () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		log.info('read.toggle');
		log.error('ingest.error');

		expect(logSpy.mock.calls[0][0]).toEqual({ level: 'info', event: 'read.toggle' });
		expect(errSpy.mock.calls[0][0]).toEqual({ level: 'error', event: 'ingest.error' });
	});
});
