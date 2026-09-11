import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { unstable_readConfig } from 'wrangler';
import { configPath, runDir, stateDir } from './runtime.mjs';

const root = process.cwd();
const wrangler = join(root, 'node_modules/.bin/wrangler');
const astro = join(root, 'node_modules/.bin/astro');
const config = unstable_readConfig({ config: join(root, 'wrangler.jsonc') });
// Preserve the production runtime/binding declarations, but resolve relative
// paths against the repo before moving the config beside test-only variables.
for (const key of ['configPath', 'userConfigPath', 'topLevelName', 'definedEnvironments', 'targetEnvironment']) delete config[key];
if (Object.keys(config.unsafe).length === 0) delete config.unsafe;
config.assets.directory = resolve(root, config.assets.directory);
config.d1_databases = config.d1_databases.map((db) => ({
  ...db, migrations_dir: resolve(root, db.migrations_dir),
}));
writeFileSync(configPath, JSON.stringify(config));
writeFileSync(join(runDir, '.dev.vars'), 'AUTH_PEPPER=e2e-local-test-pepper\n');
execFileSync(wrangler, ['d1', 'migrations', 'apply', 'NEWS_DB', '--local', '--config', configPath, '--persist-to', stateDir], { stdio: 'inherit' });
// Astro resolves --config relative to the child cwd (even for absolute input).
const astroConfig = relative(runDir, join(root, 'e2e/astro.config.mjs'));
execFileSync(astro, ['build', '--config', astroConfig], { cwd: runDir, stdio: 'inherit' });
// Astro's own background-child marker keeps preview attached in agent shells.
const server = spawn(astro, ['preview', '--config', astroConfig], {
  cwd: runDir, stdio: 'inherit', env: { ...process.env, ASTRO_PREVIEW_BACKGROUND: '1' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('error', (error) => { console.error(error); process.exitCode = 1; });
server.on('close', (code) => { process.exitCode = code ?? 1; });
