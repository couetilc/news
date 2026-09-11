// Article URLs are untrusted publisher input. Only absolute HTTP(S) links may
// enter the reader; source parsers resolve legitimate relative links first.
// Reject controls and backslashes. Spaces in paths are legitimate in some RSS
// feeds (Mythic); URL handles them without changing the protocol or authority.
export function isArticleUrl(value: string): boolean {
	if (!/^https?:\/\//i.test(value) || /[\u0000-\u001f\u007f\\]/.test(value)) return false;
	try {
		const url = new URL(value);
		return url.username === '' && url.password === '';
	} catch {
		return false;
	}
}
