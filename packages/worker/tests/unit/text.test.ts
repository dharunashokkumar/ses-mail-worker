import { describe, expect, it } from "vitest";
import {
	addressList,
	displayName,
	htmlToText,
	previewOf,
	safeKeySegment,
	stripBrackets,
} from "../../src/mail/text";

describe("htmlToText", () => {
	it("drops tags and scripts and keeps the words", () => {
		const text = htmlToText(
			"<div><style>p{color:red}</style><p>Hello <b>there</b></p><p>Second</p></div>",
		);
		expect(text).toBe("Hello there\nSecond");
	});

	it("decodes the common entities", () => {
		expect(htmlToText("<p>Tom &amp; Jerry &lt;3</p>")).toBe("Tom & Jerry <3");
	});
});

describe("previewOf", () => {
	it("collapses whitespace and truncates", () => {
		const preview = previewOf(`<p>${"word ".repeat(100)}</p>`, true, 20);
		expect(preview.length).toBe(20);
		expect(preview.endsWith("…")).toBe(true);
	});
});

describe("stripBrackets", () => {
	it("returns a bare message id", () => {
		expect(stripBrackets("<abc@example.com>")).toBe("abc@example.com");
		expect(stripBrackets("abc@example.com")).toBe("abc@example.com");
	});
});

describe("safeKeySegment", () => {
	it("keeps R2 keys to safe characters", () => {
		expect(safeKeySegment("a b/c@d.com")).toBe("a_b_c@d.com");
	});
});

describe("displayName", () => {
	it("prefers the given name", () => {
		expect(displayName("Priya Raghavan", "priya@x.io")).toBe("Priya Raghavan");
	});

	it("builds a name from the local part when there is none", () => {
		expect(displayName(undefined, "priya.raghavan@x.io")).toBe("Priya Raghavan");
	});
});

describe("addressList", () => {
	it("lowercases and de-duplicates", () => {
		expect(
			addressList([{ address: "A@x.io" }, { address: "a@x.io" }, { address: null }]),
		).toEqual(["a@x.io"]);
	});
});
