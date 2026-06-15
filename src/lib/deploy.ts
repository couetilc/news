// Build-time deploy metadata for the /status page.
//
// The worker can't know its own git revision at runtime, so the SHA, ref, and
// build time are baked in at `astro build` via `vite.define` in astro.config.mjs
// (it replaces the `__DEPLOY_*__` tokens below with string literals). CI sets
// GITHUB_SHA / GITHUB_REF_NAME automatically; local builds fall back.
//
// The `typeof … !== 'undefined'` guards matter: `vite.define` only substitutes
// during a real build. Under the node vitest project (configFile:false) the
// tokens are never defined, so a bare reference would throw ReferenceError —
// the guard yields the fallback instead, and the test stubs `globalThis` to
// exercise both branches.

import { stampUTC } from './format';

declare const __DEPLOY_SHA__: string;
declare const __DEPLOY_REF__: string;
declare const __DEPLOY_TIME__: string;

export interface DeployInfo {
	sha: string;
	shortSha: string;
	ref: string;
	time: string; // raw ISO 8601 (or 'unknown' in local dev)
	timeLabel: string; // human "Jun 13, 2026 14:05 UTC" (or the raw value)
	commitUrl: string;
	observabilityUrl: string;
}

const REPO = 'couetilc/news';
// From wrangler.jsonc: account_id + worker `name`. Built from parts so the link
// stays correct if the worker is renamed (the dashboard URL shape is
// undocumented and Cloudflare has reshuffled it before — operator-facing only).
const ACCOUNT_ID = 'dbaa50e60c18b19d483578c42d9bb3ee';
const WORKER_NAME = 'news';

export function deployInfo(): DeployInfo {
	const sha =
		typeof __DEPLOY_SHA__ !== 'undefined' ? __DEPLOY_SHA__ : 'dev';
	const ref =
		typeof __DEPLOY_REF__ !== 'undefined' ? __DEPLOY_REF__ : 'local';
	const time =
		typeof __DEPLOY_TIME__ !== 'undefined' ? __DEPLOY_TIME__ : 'unknown';

	// `time` is a valid ISO 8601 string in real builds; in local dev it's the
	// 'unknown' fallback, which Date can't parse — show it verbatim then.
	const parsed = new Date(time);
	const timeLabel = Number.isNaN(parsed.getTime()) ? time : stampUTC(parsed);

	return {
		sha,
		shortSha: sha.slice(0, 7),
		ref,
		time,
		timeLabel,
		commitUrl: `https://github.com/${REPO}/commit/${sha}`,
		observabilityUrl: `https://dash.cloudflare.com/${ACCOUNT_ID}/workers/services/view/${WORKER_NAME}/production/observability`,
	};
}
