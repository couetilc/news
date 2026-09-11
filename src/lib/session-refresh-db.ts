// KV has no compare-and-set operation. An atomic D1 claim keeps requests that
// read the same old session timestamp from simultaneously refreshing one key.
// Claims expire after a minute, permitting retries if persistence fails; they
// are not authentication records. Never store/log the bearer session ID in D1.
export async function claimSessionRefresh(db: D1Database, sessionId: string, now: number): Promise<boolean> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionId));
	const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
	const [, claim] = await db.batch([
		db.prepare('DELETE FROM session_refresh_claims WHERE claimed_at < ?').bind(now - 86400),
		db.prepare(`INSERT INTO session_refresh_claims (session_hash, claimed_at) VALUES (?, ?)
			ON CONFLICT(session_hash) DO UPDATE SET claimed_at=excluded.claimed_at
			WHERE session_refresh_claims.claimed_at <= ? RETURNING session_hash`).bind(hash, now, now - 60),
	]);
	return claim.results.length === 1;
}
