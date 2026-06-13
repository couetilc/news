import { applyD1Migrations, env } from 'cloudflare:test';

// Runs once per test file (pool isolates D1 storage per file), bringing the
// local NEWS_DB up to the committed schema before any test touches it.
// TEST_MIGRATIONS is injected as a binding from vitest.config.ts.
await applyD1Migrations(env.NEWS_DB, env.TEST_MIGRATIONS);
