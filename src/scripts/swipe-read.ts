// Touch/pen enhancement of the existing read form. Axis locking gives vertical
// scrolling back to the browser; a completed left swipe submits exactly once.
// Delegation survives infinite scrolling and ClientRouter document swaps.
type Gesture = { row: HTMLElement; id: number; x: number; y: number; dx: number; horizontal: boolean };
let gesture: Gesture | undefined;
let suppressClick: HTMLElement | undefined;

function reset(): void {
	if (gesture) {
		gesture.row.style.removeProperty('--swipe-x');
		gesture.row.removeAttribute('data-swiping');
		gesture = undefined;
	}
}

document.addEventListener('pointerdown', (event) => {
	reset();
	suppressClick = undefined;
	if (!event.isPrimary || event.pointerType === 'mouse' || !(event.target instanceof Element)) return;
	if (event.target.closest('button, form, input, summary')) return;
	const row = event.target.closest<HTMLElement>('[data-feed-list] [data-swipe-read]');
	if (!row || row.querySelector('button:disabled')) return;
	gesture = { row, id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, horizontal: false };
}, { passive: true });

document.addEventListener('pointermove', (event) => {
	if (!gesture || event.pointerId !== gesture.id) return;
	const dx = event.clientX - gesture.x;
	const dy = event.clientY - gesture.y;
	if (!gesture.horizontal) {
		if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
		if (dx >= 0 || Math.abs(dx) <= Math.abs(dy) * 1.5) { reset(); return; }
		gesture.horizontal = true;
		suppressClick = gesture.row;
	}
	gesture.dx = dx;
	gesture.row.dataset.swiping = dx <= -72 ? 'ready' : 'moving';
	gesture.row.style.setProperty('--swipe-x', `${Math.max(-112, Math.min(0, dx))}px`);
}, { passive: true });

document.addEventListener('pointerup', (event) => {
	if (!gesture || event.pointerId !== gesture.id) return;
	const {row, dx, horizontal} = gesture;
	reset();
	if (horizontal && dx <= -72 && row.isConnected) row.querySelector<HTMLFormElement>('[data-read-form]')!.requestSubmit();
}, { passive: true });
document.addEventListener('pointercancel', reset, { passive: true });
document.addEventListener('astro:before-swap', reset);

// A drag beginning on a headline must never open it (or send the opened beacon),
// including a short drag that does not reach the commit threshold.
document.addEventListener('click', (event) => {
	if (suppressClick && event.target instanceof Node && suppressClick.contains(event.target)) {
		event.preventDefault();
		event.stopImmediatePropagation();
	}
	suppressClick = undefined;
}, true);
