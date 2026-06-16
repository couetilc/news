// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Unit test for the browser-only async-feedback initializer (#155, #96). Runs in
// the node project under a per-file happy-dom environment (see the docblock
// above) so `document`, HTMLFormElement, and submit-event delegation resolve —
// the workerd pool can't host a DOM, so this file is excluded there
// (vitest.workers.config.ts) and included here (vitest.node.config.ts).
//
// Importing the module for its side effect registers the single delegated
// `submit` listener on `document` — exactly what runs in the browser. Every case
// below dispatches a real bubbling submit event so it exercises that registered
// listener (not a hand-called function), which is the behavior #155 guarantees:
// one document-level listener that survives ClientRouter DOM swaps.
import '../src/scripts/enhance-forms';

beforeAll(() => {
	// happy-dom may run a submit event's default action (form submission); a
	// capture-phase preventDefault neutralizes it without stopping propagation, so
	// the module's bubble-phase listener still runs. Keeps the cases hermetic.
	document.addEventListener('submit', (e) => e.preventDefault(), true);
});

beforeEach(() => {
	document.body.innerHTML = '';
});

// Dispatch a bubbling submit on `target`, optionally with an explicit `submitter`
// (the clicked control). A plain Event has no `submitter`, so we define it when a
// test needs the submitter path; left unset, the handler falls back to the form's
// own submit button.
function dispatchSubmit(target: Element, submitter?: HTMLButtonElement): void {
	const ev = new Event('submit', { bubbles: true, cancelable: true });
	if (submitter !== undefined) {
		Object.defineProperty(ev, 'submitter', { value: submitter, configurable: true });
	}
	target.dispatchEvent(ev);
}

function readWorking(): HTMLElement {
	const working = document.createElement('span');
	working.setAttribute('data-read-working', '');
	working.hidden = true;
	working.setAttribute('aria-hidden', 'true');
	return working;
}

describe('enhance-forms — delegated submit feedback (#155)', () => {
	it('ignores a submit whose target is not a form', () => {
		const div = document.createElement('div');
		document.body.append(div);
		// form instanceof HTMLFormElement is false → the handler returns early.
		expect(() => dispatchSubmit(div)).not.toThrow();
	});

	it('marks the read square busy and reveals "Working…" (submitter is the button)', () => {
		const form = document.createElement('form');
		form.setAttribute('data-read-form', '');
		const button = document.createElement('button');
		button.type = 'submit';
		const working = readWorking();
		form.append(button, working);
		document.body.append(form);

		dispatchSubmit(form, button);

		expect(button.disabled).toBe(true);
		expect(button.getAttribute('aria-busy')).toBe('true');
		// No data-busy-label on the square → its label is left untouched.
		expect(button.textContent).toBe('');
		// "Working…" is un-hidden and un-silenced.
		expect(working.hidden).toBe(false);
		expect(working.getAttribute('aria-hidden')).toBeNull();
	});

	it('swaps the busy label on an auth/sign-out submit (data-busy-label)', () => {
		const form = document.createElement('form');
		const button = document.createElement('button');
		button.type = 'submit';
		button.dataset.busyLabel = 'Signing in…';
		button.textContent = 'Sign in';
		form.append(button);
		document.body.append(form);

		dispatchSubmit(form, button);

		expect(button.disabled).toBe(true);
		expect(button.getAttribute('aria-busy')).toBe('true');
		expect(button.textContent).toBe('Signing in…');
	});

	it('falls back to the form submit button when no submitter is reported', () => {
		const form = document.createElement('form');
		form.setAttribute('data-read-form', '');
		const button = document.createElement('button');
		button.type = 'submit';
		const working = readWorking();
		form.append(button, working);
		document.body.append(form);

		// No submitter on the event → the handler queries button[type="submit"].
		dispatchSubmit(form);

		expect(button.disabled).toBe(true);
		expect(working.hidden).toBe(false);
	});

	it('leaves a plain form (no data hook) untouched', () => {
		const form = document.createElement('form');
		const button = document.createElement('button');
		button.type = 'submit';
		form.append(button);
		document.body.append(form);

		dispatchSubmit(form);

		// Neither data-read-form nor data-busy-label → not one of ours → early out.
		expect(button.disabled).toBe(false);
		expect(button.getAttribute('aria-busy')).toBeNull();
	});

	it('reveals "Working…" even when a read form has no submit button', () => {
		const form = document.createElement('form');
		form.setAttribute('data-read-form', '');
		const working = readWorking();
		form.append(working);
		document.body.append(form);

		// button resolves to null (no submitter, no submit button), so markButtonBusy
		// is skipped — but the read form still reveals its "Working…" line.
		expect(() => dispatchSubmit(form)).not.toThrow();
		expect(working.hidden).toBe(false);
	});

	it('handles a read form with no "Working…" line', () => {
		const form = document.createElement('form');
		form.setAttribute('data-read-form', '');
		const button = document.createElement('button');
		button.type = 'submit';
		form.append(button);
		document.body.append(form);

		// No [data-read-working] present → revealWorking finds nothing, but the
		// square still goes busy.
		dispatchSubmit(form, button);

		expect(button.disabled).toBe(true);
	});
});
