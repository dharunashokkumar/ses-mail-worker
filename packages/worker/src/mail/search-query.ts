/**
 * Search query language: `from:priya has:attachment is:unread before:2026-01-01`.
 *
 * Free text goes to the FTS5 index; the operators become SQL predicates. Pure
 * so it can be unit tested without a Durable Object.
 */

export interface ParsedQuery {
	/** Free-text terms, already escaped for an FTS5 MATCH expression. */
	match: string | null;
	from: string[];
	to: string[];
	subject: string[];
	labels: string[];
	category: string | null;
	folder: string | null;
	hasAttachment: boolean;
	isUnread: boolean | null;
	isFlagged: boolean | null;
	isPinned: boolean | null;
	before: string | null;
	after: string | null;
}

const EMPTY: ParsedQuery = {
	match: null,
	from: [],
	to: [],
	subject: [],
	labels: [],
	category: null,
	folder: null,
	hasAttachment: false,
	isUnread: null,
	isFlagged: null,
	isPinned: null,
	before: null,
	after: null,
};

/** Split on whitespace but keep "quoted phrases" together. */
function tokenize(input: string): string[] {
	return (input.match(/"[^"]*"|\S+/g) ?? []).map((token) => token.trim());
}

function unquote(value: string): string {
	return value.replace(/^"(.*)"$/, "$1");
}

/** Dates arrive as YYYY-MM-DD; emails store ISO timestamps. */
function normaliseDate(value: string, endOfDay: boolean): string | null {
	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return null;
	return endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
}

/**
 * FTS5 treats many characters as syntax. Quoting each term keeps user input
 * (`user@host.com`, `re:`, `-`) from throwing a malformed-MATCH error, and a
 * trailing `*` keeps search-as-you-type useful.
 */
function toMatchExpression(terms: string[]): string | null {
	const cleaned = terms
		.map((term) => unquote(term).replace(/"/g, "").trim())
		.filter((term) => term.length > 0);
	if (cleaned.length === 0) return null;
	return cleaned
		.map((term, index) => {
			const isLast = index === cleaned.length - 1;
			const prefixable = isLast && term.length >= 2 && !/\s/.test(term);
			return prefixable ? `"${term}"*` : `"${term}"`;
		})
		.join(" ");
}

export function parseSearchQuery(input: string): ParsedQuery {
	const parsed: ParsedQuery = {
		...EMPTY,
		from: [],
		to: [],
		subject: [],
		labels: [],
	};
	const text: string[] = [];

	for (const token of tokenize(input ?? "")) {
		const operator = token.match(/^(-?)([a-z]+):(.*)$/i);
		if (!operator) {
			text.push(token);
			continue;
		}
		const [, negation, rawKey, rawValue] = operator;
		const key = rawKey.toLowerCase();
		const value = unquote(rawValue).trim();
		if (!value) {
			text.push(token);
			continue;
		}
		const negated = negation === "-";

		switch (key) {
			case "from":
				parsed.from.push(value.toLowerCase());
				break;
			case "to":
			case "cc":
				parsed.to.push(value.toLowerCase());
				break;
			case "subject":
				parsed.subject.push(value);
				break;
			case "label":
				parsed.labels.push(value.toLowerCase());
				break;
			case "category":
				parsed.category = value.toLowerCase();
				break;
			case "in":
			case "folder":
				parsed.folder = value.toLowerCase();
				break;
			case "has":
				if (/^(attachment|file|attachments)$/i.test(value)) {
					parsed.hasAttachment = true;
				} else {
					text.push(token);
				}
				break;
			case "is":
				switch (value.toLowerCase()) {
					case "unread":
						parsed.isUnread = !negated;
						break;
					case "read":
						parsed.isUnread = negated;
						break;
					case "flagged":
					case "starred":
						parsed.isFlagged = !negated;
						break;
					case "pinned":
						parsed.isPinned = !negated;
						break;
					default:
						text.push(token);
				}
				break;
			case "before":
				parsed.before = normaliseDate(value, false);
				if (!parsed.before) text.push(token);
				break;
			case "after":
			case "since":
				parsed.after = normaliseDate(value, false);
				if (!parsed.after) text.push(token);
				break;
			case "on": {
				const start = normaliseDate(value, false);
				const end = normaliseDate(value, true);
				if (start && end) {
					parsed.after = start;
					parsed.before = end;
				} else {
					text.push(token);
				}
				break;
			}
			default:
				text.push(token);
		}
	}

	parsed.match = toMatchExpression(text);
	return parsed;
}

/** True when the query says nothing at all, so the caller can skip the search. */
export function isEmptyQuery(query: ParsedQuery): boolean {
	return (
		!query.match &&
		query.from.length === 0 &&
		query.to.length === 0 &&
		query.subject.length === 0 &&
		query.labels.length === 0 &&
		!query.category &&
		!query.folder &&
		!query.hasAttachment &&
		query.isUnread === null &&
		query.isFlagged === null &&
		query.isPinned === null &&
		!query.before &&
		!query.after
	);
}
