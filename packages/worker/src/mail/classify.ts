/**
 * Inbound classification: auto categories, spam signals and List-Unsubscribe.
 *
 * Pure functions, unit tested in tests/unit/classify.test.ts. They run inside
 * the Durable Object so the Worker request stays under its 10 ms CPU budget.
 */

export type Category = "newsletters" | "notifications" | "receipts" | null;

export interface HeaderBag {
	get(name: string): string | undefined;
}

/** Build a case-insensitive lookup over postal-mime's header list. */
export function headerBag(
	headers: Array<{ key: string; value: string }> | undefined,
): HeaderBag {
	const map = new Map<string, string>();
	for (const header of headers ?? []) {
		const key = header.key.toLowerCase();
		// Keep the first occurrence; SES and Email Routing append their own copies.
		if (!map.has(key)) map.set(key, header.value);
	}
	return { get: (name: string) => map.get(name.toLowerCase()) };
}

const BOT_LOCAL_PARTS =
	/^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|bot|builds?|ci|status|updates?|postmaster)$/i;
const RECEIPT_SUBJECT =
	/\b(invoice|receipt|payment|paid|billed|billing|order\s*#?\d|subscription renew|your order|refund|statement)\b/i;
const NEWSLETTER_SUBJECT =
	/\b(newsletter|digest|weekly|issue\s*#?\d|this week|roundup)\b/i;

/** Decide the automatic category for a message. */
export function categorise(input: {
	headers: HeaderBag;
	sender: string;
	subject: string;
	text: string;
}): Category {
	const { headers, sender, subject } = input;
	const localPart = sender.split("@")[0] || "";
	const hasListId = Boolean(headers.get("list-id"));
	const hasUnsubscribe = Boolean(headers.get("list-unsubscribe"));
	const precedence = (headers.get("precedence") || "").toLowerCase();
	const autoSubmitted = (headers.get("auto-submitted") || "").toLowerCase();

	if (RECEIPT_SUBJECT.test(subject)) return "receipts";
	if (hasListId || hasUnsubscribe || NEWSLETTER_SUBJECT.test(subject)) {
		// Transactional senders also set List-Unsubscribe; a bulk precedence or a
		// List-Id is what actually marks a newsletter.
		if (hasListId || precedence === "bulk" || precedence === "list") {
			return "newsletters";
		}
		if (hasUnsubscribe && !BOT_LOCAL_PARTS.test(localPart)) {
			return "newsletters";
		}
	}
	if (
		BOT_LOCAL_PARTS.test(localPart) ||
		autoSubmitted.startsWith("auto-") ||
		precedence === "auto_reply"
	) {
		return "notifications";
	}
	return null;
}

export interface AuthResults {
	spf: string | null;
	dkim: string | null;
	dmarc: string | null;
}

/** Read SPF/DKIM/DMARC verdicts out of an Authentication-Results header. */
export function parseAuthResults(header: string | undefined): AuthResults {
	const read = (method: string): string | null => {
		if (!header) return null;
		const match = header.match(
			new RegExp(`\\b${method}\\s*=\\s*([a-z]+)`, "i"),
		);
		return match ? match[1].toLowerCase() : null;
	};
	return { spf: read("spf"), dkim: read("dkim"), dmarc: read("dmarc") };
}

export interface SpamVerdict {
	isSpam: boolean;
	score: number;
	reason: string | null;
}

/**
 * Score a message from its authentication results and the blocklist.
 * Cloudflare Email Routing already rejects the worst traffic, so this only has
 * to catch what makes it through: failed authentication and blocked senders.
 */
export function spamVerdict(input: {
	auth: AuthResults;
	sender: string;
	blocked: Set<string>;
	subject: string;
}): SpamVerdict {
	const { auth, sender, blocked, subject } = input;
	const reasons: string[] = [];
	let score = 0;

	const domain = sender.split("@")[1]?.toLowerCase() ?? "";
	if (blocked.has(sender.toLowerCase())) {
		reasons.push("sender blocked");
		score += 10;
	} else if (domain && blocked.has(`@${domain}`)) {
		reasons.push("domain blocked");
		score += 10;
	}

	if (auth.dmarc === "fail") {
		reasons.push("DMARC fail");
		score += 4;
	}
	if (auth.spf === "fail" || auth.spf === "softfail") {
		reasons.push(`SPF ${auth.spf}`);
		score += auth.spf === "fail" ? 3 : 1;
	}
	if (auth.dkim === "fail") {
		reasons.push("DKIM fail");
		score += 2;
	}
	if (!auth.spf && !auth.dkim && !auth.dmarc) {
		reasons.push("unauthenticated");
		score += 1;
	}
	if (
		/\b(verify your account|suspended|urgent action|wire transfer)\b/i.test(
			subject,
		)
	) {
		reasons.push("suspicious subject");
		score += 2;
	}

	return {
		isSpam: score >= 4,
		score,
		reason: reasons.length ? reasons.join(" · ") : null,
	};
}

/** The one-click unsubscribe target, preferring the mailto: form. */
export function unsubscribeTarget(header: string | undefined): string | null {
	if (!header) return null;
	const targets = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
	const mailto = targets.find((t) => t.toLowerCase().startsWith("mailto:"));
	const http = targets.find((t) => /^https?:/i.test(t));
	return mailto ?? http ?? null;
}
