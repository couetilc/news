import { defineConfig, devices } from '@playwright/test';
import { basename, join } from 'node:path';
import { baseURL, runDir } from './e2e/runtime.mjs';

export default defineConfig({
	testDir: './e2e',
	outputDir: join('test-results', basename(runDir)),
	// Cases share this run's workerd server and reset its bindings via fixtures.
	workers: 1,
	fullyParallel: false,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI
		? [['list'], ['github'], ['json', { outputFile: join('playwright-report', basename(runDir), 'results.json') }]]
		: [['list']],
	use: { baseURL, trace: 'retain-on-failure' },
	projects: [{
		name: 'chromium',
		use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--no-sandbox'] } },
	}],
	// Build and preview the real app in workerd; never reuse an existing server.
	// strictPort in e2e/astro.config.mjs also rejects a port stolen during build.
	webServer: {
		command: 'node ./e2e/start-server.mjs',
		url: baseURL,
		reuseExistingServer: false,
		timeout: 180_000,
	},
});
