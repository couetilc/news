import { test, expect } from './fixtures';
import { d1Query, setSessionRefreshTime } from './d1';

test('rapid activity stays read-only; a due session refresh extends the persistent cookie once', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Email').fill('connor@couetil.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/');
  const before = (await page.context().cookies()).find(c => c.name === 'astro-session')!;
  expect(before.expires).toBeGreaterThan(Date.now() / 1000);
  expect(d1Query('SELECT * FROM session_refresh_claims')).toEqual([]);
  const rapid = await page.evaluate(async () => Promise.all(Array.from({ length: 4 }, async () => {
    const response = await fetch('/status');
    return response.status;
  })));
  expect(rapid).toEqual([200, 200, 200, 200]);
  expect((await page.context().cookies()).find(c => c.name === 'astro-session')!.expires).toBe(before.expires);
  expect(d1Query('SELECT * FROM session_refresh_claims')).toEqual([]);

  // Cookie expiry has one-second precision. Age the actual stored session;
  // waiting one second alone must no longer cause a refresh.
  await setSessionRefreshTime(before.value, Math.floor(Date.now() / 1000) - 3600);
  await page.waitForTimeout(1100);
  const due = await page.evaluate(async () => Promise.all(Array.from({ length: 4 }, async () => (await fetch('/status')).status)));
  expect(due).toEqual([200, 200, 200, 200]);
  const after = (await page.context().cookies()).find(c => c.name === 'astro-session')!;
  expect(after.value).toBe(before.value);
  expect(after.expires).toBeGreaterThan(before.expires);
  expect(after.expires - Date.now() / 1000).toBeGreaterThan(14 * 86400 - 60);
  expect(after.httpOnly).toBe(true);
  expect(d1Query('SELECT COUNT(*) AS count FROM session_refresh_claims')).toEqual([{ count: 1 }]);
  await page.reload();
  expect((await page.context().cookies()).find(c => c.name === 'astro-session')!.expires).toBe(after.expires);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');
  expect((await page.context().cookies()).find(c => c.name === 'astro-session')).toBeUndefined();
});
