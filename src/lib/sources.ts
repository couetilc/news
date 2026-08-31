// Presentation metadata for a feed source: the human display name and the
// identity mark that distinguishes it on the homepage. Source rows store only a
// slug (e.g. "cloudflare-blog"); this turns that slug into a proper name and
// the mark's variant classes (the `.mark-*` component classes + `--color-beat-*`
// hue tokens in src/styles/global.css, rendered by Article/FilterBar as
// `mark ${mark}`). The class names are written as full literal strings so the
// registry stays greppable and test/source-meta.test.ts can cross-check every
// class against the stylesheet.
//
// Each mark dimension encodes one discriminating factor (full rationale in
// global.css): mark-beat-* = which desk the FEED reports to — classified by
// what the feed carries, not the company's logo (the `aws` feed is filtered to
// AWS-silicon terms yet stays a platform-vendor wire; `open-models` is an
// aggregate AI backstop) — mark-diamond = open-weight AI sub-beat, and the
// fill (solid/hollow/half/hatch/dots) = the source within the beat, assigned
// in arrival order and NEVER reshuffled, so learned marks stay stable. A new
// source takes its beat's next free fill; a beat outgrowing five fills earns a
// sub-beat shape split (as AI did); hatch marks a beat's aggregate feed.
//
// An unregistered source (in the DB but not yet listed here) falls back to its
// raw slug and a neutral muted solid square — visible, never a crash.

export interface SourceMeta {
	name: string;
	mark: string; // `mark-*` variant classes for the identity glyph
}

const REGISTRY: Record<string, SourceMeta> = {
	'cloudflare-blog': { name: 'Cloudflare Blog', mark: 'mark-beat-platform mark-solid' },
	'ieee-spectrum': { name: 'IEEE Spectrum', mark: 'mark-beat-press mark-solid' },
	apple: { name: 'Apple', mark: 'mark-beat-platform mark-hollow' },
	'science-daily': { name: 'ScienceDaily', mark: 'mark-beat-press mark-hollow' },
	amd: { name: 'AMD', mark: 'mark-beat-silicon mark-solid' },
	qualcomm: { name: 'Qualcomm', mark: 'mark-beat-silicon mark-hollow' },
	intel: { name: 'Intel', mark: 'mark-beat-silicon mark-half' },
	nvidia: { name: 'NVIDIA', mark: 'mark-beat-silicon mark-hatch' },
	elonlit: { name: 'Elon Litman', mark: 'mark-beat-voices mark-solid' },
	anthropic: { name: 'Anthropic', mark: 'mark-beat-ai mark-solid' },
	aws: { name: 'AWS', mark: 'mark-beat-platform mark-half' },
	cisco: { name: 'Cisco', mark: 'mark-beat-platform mark-hatch' },
	ti: { name: 'Texas Instruments', mark: 'mark-beat-silicon mark-dots' },
	'eye-on-the-market': { name: 'Eye on the Market', mark: 'mark-beat-markets mark-solid' },
	mistral: { name: 'Mistral', mark: 'mark-beat-ai mark-solid mark-diamond' },
	openai: { name: 'OpenAI', mark: 'mark-beat-ai mark-hollow' },
	'thinking-machines': { name: 'Thinking Machines', mark: 'mark-beat-ai mark-half' },
	owenomics: { name: 'Owenomics', mark: 'mark-beat-markets mark-hollow' },
	// #340 — one combined chip for the Hugging Face lab-filtered backstop feed
	// (the AI beat's aggregate, so it takes the hatch)…
	'open-models': { name: 'Open Models', mark: 'mark-beat-ai mark-hatch mark-diamond' },
	// …plus a per-lab chip for each verified OpenRSS proxy (only DeepSeek so far).
	deepseek: { name: 'DeepSeek', mark: 'mark-beat-ai mark-hollow mark-diamond' },
	cursor: { name: 'Cursor', mark: 'mark-beat-platform mark-dots' },
};

export function sourceMeta(slug: string): SourceMeta {
	return REGISTRY[slug] ?? { name: slug, mark: 'mark-solid' };
}
