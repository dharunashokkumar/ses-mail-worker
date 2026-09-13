import { describe, expect, it } from "vitest";
import { buildMimeMessage } from "../../src/mime-builder";

describe("buildMimeMessage", () => {
	it("writes a Cc header and leaves Bcc out of the message", () => {
		const mime = buildMimeMessage({
			from: "me@dharun.dev",
			to: ["a@example.com"],
			cc: ["b@example.com"],
			bcc: ["hidden@example.com"],
			subject: "Hello",
			text: "Hello",
		});
		expect(mime).toContain("Cc: b@example.com\r\n");
		expect(mime).not.toContain("hidden@example.com");
	});

	it("refuses to let a header value break the header block", () => {
		const mime = buildMimeMessage({
			from: "me@dharun.dev",
			to: ["a@example.com\r\nBcc: sneaky@example.com"],
			cc: ["b@example.com\nX-Injected: yes"],
			subject: "Hello\r\nX-Also-Injected: yes",
			text: "Hello",
		});
		// The injected text survives as part of the value it was hidden in, but
		// no longer starts a line, so it is not a header.
		const lines = mime.split("\r\n");
		expect(lines.some((line) => line.startsWith("Bcc:"))).toBe(false);
		expect(lines.some((line) => line.startsWith("X-Injected:"))).toBe(false);
		expect(lines.some((line) => line.startsWith("X-Also-Injected:"))).toBe(false);
		expect(mime).toContain("To: a@example.com Bcc: sneaky@example.com\r\n");
	});
});
