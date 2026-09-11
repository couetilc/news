// Specs requiring real D1, KV, or workerd Web Crypto. All other specs run in node.
// Add a file here only when it needs runtime parity, not for pure decision logic.
export const WORKER_TESTS = [
	'test/auth-actions.test.ts',
	'test/auth.prop.test.ts',
	'test/auth.test.ts',
	'test/backfill-item-reads.test.ts',
	'test/db.test.ts',
	'test/health-db.test.ts',
	'test/dedupe-items-by-url.test.ts',
	'test/intel-canonical-urls.test.ts',
	'test/logout-endpoint.test.ts',
	'test/read-endpoint.test.ts',
	'test/run.test.ts',
	'test/users.test.ts',
];
