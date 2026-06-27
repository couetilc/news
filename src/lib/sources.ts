// Presentation metadata for a feed source: the human display name and the
// swatch color used to distinguish it on the homepage. Source rows store only a
// slug (e.g. "cloudflare-blog"); this turns that slug into a proper name and a
// Tailwind `bg-source-*` utility class (the colors are --color-source-* theme
// tokens in src/styles/global.css). The class names are written as full literal
// strings so Tailwind's scanner sees them.
//
// An unregistered source (in the DB but not yet listed here) falls back to its
// raw slug and the neutral muted rule — visible, never a crash.

export interface SourceMeta {
	name: string;
	swatch: string; // a `bg-*` utility class for the color flag
}

const REGISTRY: Record<string, SourceMeta> = {
	'cloudflare-blog': { name: 'Cloudflare Blog', swatch: 'bg-source-cloudflare' },
	'ieee-spectrum': { name: 'IEEE Spectrum', swatch: 'bg-source-ieee' },
	apple: { name: 'Apple', swatch: 'bg-source-apple' },
	'science-daily': { name: 'ScienceDaily', swatch: 'bg-source-science-daily' },
	amd: { name: 'AMD', swatch: 'bg-source-amd' },
	qualcomm: { name: 'Qualcomm', swatch: 'bg-source-qualcomm' },
	intel: { name: 'Intel', swatch: 'bg-source-intel' },
	nvidia: { name: 'NVIDIA', swatch: 'bg-source-nvidia' },
	elonlit: { name: 'Elon Litman', swatch: 'bg-source-elonlit' },
	anthropic: { name: 'Anthropic', swatch: 'bg-source-anthropic' },
	aws: { name: 'AWS', swatch: 'bg-source-aws' },
	cisco: { name: 'Cisco', swatch: 'bg-source-cisco' },
	ti: { name: 'Texas Instruments', swatch: 'bg-source-ti' },
	'eye-on-the-market': { name: 'Eye on the Market', swatch: 'bg-source-eotm' },
};

export function sourceMeta(slug: string): SourceMeta {
	return REGISTRY[slug] ?? { name: slug, swatch: 'bg-muted' };
}
