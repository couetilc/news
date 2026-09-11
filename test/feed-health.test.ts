import { expect, it } from 'vitest';
import { feedVerdict, healthViews, healthTime, runVerdict, OVERDUE_GRACE_SECONDS } from '../src/lib/feed-health';
import type { FeedConfig } from '../src/ingest/types';
import type { FeedHealth, IngestRun } from '../src/ingest/health-db';
const now = 10000000;
const config: FeedConfig = { source: 'openai', feed: 'https://example.com/feed', pollIntervalSeconds: 3600, parse: () => [] };
const row = (over: Partial<FeedHealth> = {}): FeedHealth => ({ ...healthViews([config], [], now).active[0].state, last_attempt_at: now - 100, last_finished_at: now - 90, last_success_at: now - 90, last_clean_at: now - 90, next_poll_at: now + 1000, last_published_at: now - 1000, ...over });
const run = (over: Partial<IngestRun> = {}): IngestRun => ({ id: 1, started_at: now - 100, finished_at: now - 90, polled: 2, failed_feeds: 0, anomalous_feeds: 0, error: null, ...over });
it('reconciles never-polled active sources and retired endpoints without false overdue warnings', () => {
	const retired = row({ feed: 'https://retired.test', next_poll_at: 1 });
	const health = healthViews([config], [retired], now);
	expect(health.active[0].name).toBe('OpenAI');
	expect(health.active[0].verdict.key).toBe('never');
	expect(health.retired[0].verdict.key).toBe('retired');
	expect(health.attention).toBe(1);
	expect(healthViews([config], [row()], now).attention).toBe(0);
});
it('prioritizes current failures and unresolved anomalies over stale successful HTTP status', () => {
	expect(feedVerdict(row({ failure_count: 3, last_status: 200 }), now)).toMatchObject({ key: 'failing', attention: true, note: '3 consecutive failed checks.' });
	expect(feedVerdict(row({ last_anomaly: 'zero_parsed_of_raw', anomaly_resolved_at: null }), now).key).toBe('anomaly');
	expect(feedVerdict(row({ last_anomaly: 'zero_parsed_of_raw', anomaly_resolved_at: now - 1 }), now).key).toBe('healthy');
});
it('uses a scheduling grace period and does not confuse a quiet publisher with failed checks', () => {
	expect(OVERDUE_GRACE_SECONDS).toBe(1800);
	expect(feedVerdict(row({ next_poll_at: now - 1800 }), now).key).toBe('healthy');
	expect(feedVerdict(row({ next_poll_at: now - 1801 }), now).key).toBe('overdue');
	expect(feedVerdict(row({ last_published_at: now - 30 * 86400 }), now).key).toBe('healthy');
	expect(feedVerdict(row({ last_published_at: now - 30 * 86400 - 1 }), now)).toMatchObject({ key: 'quiet', attention: false });
	expect(feedVerdict(row({ last_published_at: null, last_saved_at: now - 100 }), now).key).toBe('healthy');
	expect(feedVerdict(row({ last_published_at: null, last_saved_at: null }), now).key).toBe('quiet');
});
it('distinguishes heartbeat starts, finishes, gaps, fatal failures, and per-feed problems', () => {
	expect(runVerdict(undefined, now).key).toBe('never');
	expect(runVerdict(run({ error: 'database unavailable' }), now).key).toBe('failed');
	expect(runVerdict(run({ finished_at: null, started_at: now - 900 }), now).key).toBe('running');
	expect(runVerdict(run({ finished_at: null, started_at: now - 901 }), now).key).toBe('stuck');
	expect(runVerdict(run({ started_at: now - 1801 }), now).key).toBe('overdue');
	expect(runVerdict(run({ started_at: now - 1800 }), now).key).toBe('complete');
	expect(runVerdict(run({ failed_feeds: 1 }), now)).toMatchObject({ key: 'issues', note: '1 failed checks; 0 parsing anomalies.' });
	expect(runVerdict(run({ anomalous_feeds: 1 }), now).key).toBe('issues');
});
it('formats explicit UTC timestamps while preserving unknown history', () => {
	expect(healthTime(null)).toBe('Not recorded');
	expect(healthTime(0)).toBe('1970-01-01 00:00 UTC');
});
it('does not present a started but incomplete feed attempt as a success', () => {
	expect(feedVerdict(row({ last_attempt_at: now - 120, last_finished_at: null }), now).key).toBe('checking');
	expect(feedVerdict(row({ last_attempt_at: now - 121, last_finished_at: null }), now).key).toBe('interrupted');
	expect(feedVerdict(row({ last_attempt_at: now - 10, last_finished_at: now - 100 }), now).key).toBe('checking');
	expect(feedVerdict(row({ last_attempt_at: now - 121, last_finished_at: now - 200 }), now).key).toBe('interrupted');
	for (const response_status of [200, 304]) {
		expect(feedVerdict(row({ last_attempt_at: now - 121, last_finished_at: now - 1, response_status }), now).key).toBe('healthy');
	}
});
it('places actionable feed failures ahead of healthy endpoints', () => {
	const second = { ...config, feed: 'https://second.test' };
	const views = healthViews([config, second], [row(), row({ feed: second.feed, failure_count: 2 })], now);
	expect(views.active.map(view => view.verdict.key)).toEqual(['failing', 'healthy']);
});

it('keeps attention counts, explanatory copy, and priority order useful for a mixed registry', () => {
	const states = [
		row({ feed: 'quiet', last_published_at: null, last_saved_at: null }),
		row({ feed: 'healthy' }),
		row({ feed: 'checking', last_attempt_at: now, last_finished_at: now - 100 }),
		row({ feed: 'never', last_attempt_at: null }),
		row({ feed: 'overdue', next_poll_at: now - 1801 }),
		row({ feed: 'interrupted', last_attempt_at: now - 121, last_finished_at: now - 200 }),
		row({ feed: 'anomaly', last_anomaly: 'A parse concern' }),
		row({ feed: 'failing', failure_count: 2 }),
	];
	const retired = row({ feed: 'old endpoint' });
	const configs = states.map(state => ({ ...config, feed: state.feed }));
	const views = healthViews(configs, [...states, retired], now);
	expect(views.active.map(view => view.verdict.key)).toEqual([
		'failing', 'anomaly', 'interrupted', 'overdue', 'never', 'checking', 'healthy', 'quiet',
	]);
	expect(views.active.map(view => view.verdict.attention)).toEqual([true, true, true, true, true, false, false, false]);
	expect(views.attention).toBe(5);
	expect(views.retired.map(view => view.state.feed)).toEqual(['old endpoint']);
	expect(views.retired[0].verdict.attention).toBe(false);
	// Every displayed row needs a visible status and explanation, including
	// quiet/retired rows which must not inflate the attention count.
	for (const view of [...views.active, ...views.retired]) {
		expect(view.verdict.label).toMatch(/\S/);
		expect(view.verdict.note).toMatch(/\S/);
	}
});

it('alerts on missing/failed cron runs but leaves current or completed runs informational', () => {
	const cases = [
		[undefined, true],
		[run({ error: 'Database unavailable' }), true],
		[run({ finished_at: null, started_at: now - 901 }), true],
		[run({ started_at: now - 1801 }), true],
		[run({ failed_feeds: 1 }), true],
		[run({ finished_at: null }), false],
		[run(), false],
	] as const;
	for (const [state, attention] of cases) {
		const verdict = runVerdict(state, now);
		expect(verdict.attention).toBe(attention);
		expect(verdict.label).toMatch(/\S/);
		expect(verdict.note).toMatch(/\S/);
	}
});

it('handles a fast same-second completion and formats a real stored timestamp', () => {
	expect(feedVerdict(row({ last_attempt_at: now - 1, last_finished_at: now - 1 }), now).key).toBe('healthy');
	expect(healthTime(1789132800)).toBe('2026-09-11 13:20 UTC');
});
