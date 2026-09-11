/**
 * Text helpers shared by the inbound pipeline and the search index.
 *
 * Everything here is pure so it runs inside the Durable Object (30 s CPU)
 * without pulling a parser into the 10 ms Worker request.
 */

const BLOCK_TAGS =
	/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|table|br)\s*>/gi;

/** Strip HTML down to readable text: no tags, no scripts, collapsed whitespace. */
export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(BLOCK_TAGS, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.trim();
}

/** One-line preview for a message row. */
export function previewOf(body: string, isHtml: boolean, length = 220): string {
	const text = (isHtml ? htmlToText(body) : body).replace(/\s+/g, " ").trim();
	return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** Bare message id: `<abc@host>` -> `abc@host`. */
export function stripBrackets(value: string): string {
	return value.trim().replace(/^</, "").replace(/>$/, "");
}

/** Message ids are used in R2 keys, so keep them to safe characters. */
export function safeKeySegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._@+-]/g, "_").slice(0, 180);
}

/** Display name for an address, falling back to the local part. */
export function displayName(name: string | undefined, address: string): string {
	const trimmed = (name || "").trim();
	if (trimmed) return trimmed;
	const local = address.split("@")[0] || address;
	return local
		.split(/[._-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

/** Normalise an address list header into unique lowercase addresses. */
export function addressList(
	list: Array<{ address?: string | null }> | undefined | null,
): string[] {
	if (!list) return [];
	const seen = new Set<string>();
	for (const entry of list) {
		const address = entry.address?.trim().toLowerCase();
		if (address) seen.add(address);
	}
	return [...seen];
}
