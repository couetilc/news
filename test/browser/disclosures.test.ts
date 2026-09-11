// @vitest-environment happy-dom
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
const media = new EventTarget() as EventTarget & {
	matches: boolean;
};
media.matches = false;
const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(media as MediaQueryList);
await import('../../src/scripts/disclosures');
afterAll(() => matchMedia.mockRestore());
beforeEach(() => { document.body.innerHTML = '<details class="source-filter"><summary>Sources</summary></details>'; media.matches = false; });
it('keeps sources collapsed on phones and opens them on desktop across resize', () => {
	const details = document.querySelector('details')!;
	document.dispatchEvent(new Event('DOMContentLoaded'));
	expect(details.open).toBe(false);
	media.matches = true;
	media.dispatchEvent(new Event('change'));
	expect(details.open).toBe(true);
	media.matches = false;
	media.dispatchEvent(new Event('change'));
	expect(details.open).toBe(false);
});
it('initializes a replacement disclosure after Astro navigation', () => {
	media.matches = true;
	document.dispatchEvent(new Event('astro:page-load'));
	expect(document.querySelector('details')!.open).toBe(true);
	document.body.innerHTML = '';
	media.dispatchEvent(new Event('change'));
	expect(document.querySelectorAll('details')).toHaveLength(0);
});
