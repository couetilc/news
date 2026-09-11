import type { FeedConfig } from '../ingest/types';
import type { FeedHealth, IngestRun } from '../ingest/health-db';
import { sourceMeta } from './sources';
export const OVERDUE_GRACE_SECONDS = 30 * 60;
const QUIET_SECONDS = 30 * 86400;
export interface HealthVerdict {
	key: string;
	label: string;
	attention: boolean;
	note: string;
}

export interface HealthView {
	state: FeedHealth;
	name: string;
	verdict: HealthVerdict;
}
const EMPTY: FeedHealth = {
	feed: '', source: '', etag: null, last_modified: null, next_poll_at: 0, last_status: null, failure_count: 0, state_json: null,
	last_attempt_at: null, last_finished_at: null, response_status: null, last_success_at: null, last_clean_at: null,
	last_error: null, last_error_at: null, error_resolved_at: null, last_anomaly: null, last_anomaly_at: null, anomaly_resolved_at: null,
	last_saved_at: null, last_published_at: null, item_count: 0,
};
export function feedVerdict(state: FeedHealth, now: number): HealthVerdict {
	if (state.last_attempt_at !== null && (state.last_finished_at === null || state.last_attempt_at > state.last_finished_at)) {
		return now - state.last_attempt_at > 120
			? { key: 'interrupted', label: 'Check did not finish', attention: true, note: 'The attempt started more than two minutes ago without completion.' }
			: { key: 'checking', label: 'Checking', attention: false, note: 'An attempt is in progress; its outcome is not known yet.' };
	}
	if (state.failure_count > 0)
		return { key: 'failing', label: 'Failing', attention: true, note: `${state.failure_count} consecutive failed checks.` };
	if (state.last_anomaly !== null && state.anomaly_resolved_at === null)
		return { key: 'anomaly', label: 'Check parser', attention: true, note: 'A parsing anomaly remains unresolved; an unchanged response does not prove recovery.' };
	if (state.last_attempt_at === null)
		return { key: 'never', label: 'Not checked yet', attention: true, note: 'No attempt recorded by the current health tracker.' };
	if (state.next_poll_at + OVERDUE_GRACE_SECONDS < now)
		return { key: 'overdue', label: 'Overdue', attention: true, note: 'The next check is more than 30 minutes late.' };
	const newest = state.last_published_at ?? state.last_saved_at;
	if (newest === null || newest < now - QUIET_SECONDS)
		return { key: 'quiet', label: 'Quiet publisher', attention: false, note: 'Checks are passing; no recent articles are available. Publication frequency is not a polling failure.' };
	return { key: 'healthy', label: 'Healthy', attention: false, note: 'The latest check passed and no parsing anomaly remains.' };
}

export function healthViews(configs: readonly FeedConfig[], rows: readonly FeedHealth[], now: number): {
	active: HealthView[];
	retired: HealthView[];
	attention: number;
} {
	const stored = new Map(rows.map(row => [row.feed, row]));
	const feeds = new Set(configs.map(config => config.feed));
	const active = configs.map(config => {
		const state = stored.get(config.feed) ?? { ...EMPTY, feed: config.feed, source: config.source };
		return { state, name: sourceMeta(config.source).name, verdict: feedVerdict(state, now) };
	});
	const priority = ['failing', 'anomaly', 'interrupted', 'overdue', 'never', 'checking', 'healthy', 'quiet'];
	active.sort((a, b) => priority.indexOf(a.verdict.key) - priority.indexOf(b.verdict.key));
	const retired = rows.filter(row => !feeds.has(row.feed)).map(state => ({ state, name: sourceMeta(state.source).name,
		verdict: { key: 'retired', label: 'Retired', attention: false, note: 'This endpoint is no longer in the active source registry.' } }));
	return { active, retired, attention: active.filter(view => view.verdict.attention).length };
}

export function runVerdict(run: IngestRun | undefined, now: number): HealthVerdict {
	if (!run)
		return { key: 'never', label: 'Waiting for the first tracked run', attention: true, note: 'Start and completion will be recorded separately on the next scheduled check.' };
	if (run.error !== null)
		return { key: 'failed', label: 'Batch failed', attention: true, note: 'The invocation stopped before all due feeds could complete.' };
	if (run.finished_at === null)
		return now - run.started_at > 15 * 60
			? { key: 'stuck', label: 'Run has not finished', attention: true, note: 'Started more than 15 minutes ago without a completion record.' }
			: { key: 'running', label: 'Checking feeds', attention: false, note: 'Started; completion has not been recorded yet.' };
	if (now - run.started_at > OVERDUE_GRACE_SECONDS)
		return { key: 'overdue', label: 'Scheduled checks are overdue', attention: true, note: 'No run has started in more than 30 minutes.' };
	if (run.failed_feeds > 0 || run.anomalous_feeds > 0)
		return { key: 'issues', label: 'Completed with feed issues', attention: true, note: `${run.failed_feeds} failed checks; ${run.anomalous_feeds} parsing anomalies.` };
	return { key: 'complete', label: 'Last batch completed', attention: false, note: 'No errors in this batch. Individual feed health below includes earlier unresolved issues.' };
}

export function healthTime(seconds: number | null): string {
	return seconds === null ? 'Not recorded' : `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
