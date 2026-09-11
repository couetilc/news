// Native disclosures remain usable without JavaScript. Wide screens show the
// source grid by default; phones keep the active summary above the stories.
// Reapply after Astro navigation and when crossing the layout breakpoint.
const wide = window.matchMedia('(min-width: 40rem)');
function syncSourceDisclosure(): void {
	for (const details of document.querySelectorAll<HTMLDetailsElement>('.source-filter')) {
		details.open = wide.matches;
	}
}
wide.addEventListener('change', syncSourceDisclosure);
document.addEventListener('DOMContentLoaded', syncSourceDisclosure);
document.addEventListener('astro:page-load', syncSourceDisclosure);
