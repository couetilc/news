import { basename, dirname, join } from 'node:path';

// Fail closed: invoking helpers or Playwright directly must never fall back to
// the development persistence directory. Use `npm run test:e2e`.
export const runDir = process.env.NEWS_E2E_RUN_DIR;
export const port = Number(process.env.NEWS_E2E_PORT);
if (!runDir || basename(dirname(runDir)) !== '.playwright' || !basename(runDir).startsWith('run-') || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Run browser tests with npm run test:e2e (isolated state and port required).');
}
export const stateDir = join(runDir, 'state');
export const configPath = join(runDir, 'wrangler.json');
export const buildDir = join(runDir, 'build');
export const builtConfigPath = join(buildDir, 'server/wrangler.json');
export const baseURL = `http://127.0.0.1:${port}`;
