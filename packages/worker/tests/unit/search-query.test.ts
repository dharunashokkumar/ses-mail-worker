import { describe, expect, it } from "vitest";
import { isEmptyQuery, parseSearchQuery } from "../../src/mail/search-query";

describe("parseSearchQuery", () => {
	it("keeps plain words as a prefix-matching FTS expression", () => {
		const query = parseSearchQuery("cutover plan");
		expect(query.match).toBe('"cutover" "plan"*');
		expect(query.from).toEqual([]);
	});

	it("quotes terms so addresses and punctuation cannot break FTS syntax", () => {
		const query = parseSearchQuery("priya@kestrel.io");
		expect(query.match).toBe('"priya@kestrel.io"*');
	});

	it("reads the operators out of the text", () => {
		const query = parseSearchQuery(
			'from:Priya to:me@dharun.dev label:Work has:attachment is:unread before:2026-02-01 "exact words"',
		);
		expect(query.from).toEqual(["priya"]);
		expect(query.to).toEqual(["me@dharun.dev"]);
		expect(query.labels).toEqual(["work"]);
		expect(query.hasAttachment).toBe(true);
		expect(query.isUnread).toBe(true);
		expect(query.before).toBe("2026-02-01T00:00:00.000Z");
		expect(query.match).toBe('"exact words"');
	});

	it("treats is:read as the negation of unread, and -is:flagged as unflagged", () => {
		expect(parseSearchQuery("is:read").isUnread).toBe(false);
		expect(parseSearchQuery("-is:flagged").isFlagged).toBe(false);
	});

	it("turns on:DATE into a single day window", () => {
		const query = parseSearchQuery("on:2026-03-04");
		expect(query.after).toBe("2026-03-04T00:00:00.000Z");
		expect(query.before).toBe("2026-03-04T23:59:59.999Z");
	});

	it("leaves an unknown operator as search text", () => {
		const query = parseSearchQuery("colour:red");
		expect(query.match).toBe('"colour:red"*');
	});

	it("reports an empty query", () => {
		expect(isEmptyQuery(parseSearchQuery(""))).toBe(true);
		expect(isEmptyQuery(parseSearchQuery("is:unread"))).toBe(false);
	});
});
