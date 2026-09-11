import { test as base } from '@playwright/test';
import { disposeBindings, resetTestState } from './d1';
export { expect, type Page, type Locator, type Request } from '@playwright/test';

// Automatic fixtures run before beforeEach, so each case seeds its own data.
export const test = base.extend<{ isolatedState: void }, { localBindings: void }>({
	localBindings: [async ({}, use) => {
		await use();
		await disposeBindings();
	}, { scope: 'worker' }],
	isolatedState: [async ({ localBindings }, use) => {
		await resetTestState();
		await use();
	}, { auto: true }],
});
