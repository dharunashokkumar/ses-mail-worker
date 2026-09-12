import { describe, expect, it } from "vitest";
import {
	categorise,
	headerBag,
	parseAuthResults,
	spamVerdict,
	unsubscribeTarget,
} from "../../src/mail/classify";

const bag = (headers: Record<string, string>) =>
	headerBag(Object.entries(headers).map(([key, value]) => ({ key, value })));

describe("categorise", () => {
	it("files list mail as a newsletter", () => {
		expect(
			categorise({
				headers: bag({ "List-Id": "<dispatch.example.com>", "List-Unsubscribe": "<mailto:x@y.z>" }),
				sender: "editor@example.com",
				subject: "Issue 214",
				text: "",
			}),
		).toBe("newsletters");
	});

	it("files no-reply senders as notifications", () => {
		expect(
			categorise({
				headers: bag({}),
				sender: "no-reply@signalcraft.dev",
				subject: "Build passed",
				text: "",
			}),
		).toBe("notifications");
	});

	it("files invoices as receipts, even from a no-reply address", () => {
		expect(
			categorise({
				headers: bag({}),
				sender: "no-reply@atlas.example",
				subject: "Invoice ATL-2291 is ready",
				text: "",
			}),
		).toBe("receipts");
	});

	it("leaves a person's mail uncategorised", () => {
		expect(
			categorise({
				headers: bag({}),
				sender: "priya@kestrel.io",
				subject: "Thursday works",
				text: "",
			}),
		).toBeNull();
	});
});

describe("parseAuthResults", () => {
	it("reads each verdict", () => {
		const auth = parseAuthResults(
			"mx.example.com; spf=pass smtp.mailfrom=a.com; dkim=fail header.d=a.com; dmarc=fail",
		);
		expect(auth).toEqual({ spf: "pass", dkim: "fail", dmarc: "fail" });
	});

	it("returns nulls when the header is missing", () => {
		expect(parseAuthResults(undefined)).toEqual({ spf: null, dkim: null, dmarc: null });
	});
});

describe("spamVerdict", () => {
	it("holds mail that fails DMARC and SPF", () => {
		const verdict = spamVerdict({
			auth: { spf: "fail", dkim: "fail", dmarc: "fail" },
			sender: "alerts@secure-verify.top",
			blocked: new Set(),
			subject: "Verify your account",
		});
		expect(verdict.isSpam).toBe(true);
		expect(verdict.reason).toContain("DMARC fail");
	});

	it("passes authenticated mail", () => {
		const verdict = spamVerdict({
			auth: { spf: "pass", dkim: "pass", dmarc: "pass" },
			sender: "priya@kestrel.io",
			blocked: new Set(),
			subject: "Cutover window",
		});
		expect(verdict.isSpam).toBe(false);
		expect(verdict.reason).toBeNull();
	});

	it("holds mail from a blocked sender whatever its authentication says", () => {
		const verdict = spamVerdict({
			auth: { spf: "pass", dkim: "pass", dmarc: "pass" },
			sender: "spam@bad.example",
			blocked: new Set(["spam@bad.example"]),
			subject: "Hello",
		});
		expect(verdict.isSpam).toBe(true);
		expect(verdict.reason).toBe("sender blocked");
	});

	it("holds mail from a blocked domain", () => {
		const verdict = spamVerdict({
			auth: { spf: "pass", dkim: "pass", dmarc: "pass" },
			sender: "anyone@bad.example",
			blocked: new Set(["@bad.example"]),
			subject: "Hello",
		});
		expect(verdict.isSpam).toBe(true);
	});
});

describe("unsubscribeTarget", () => {
	it("prefers the mailto: form", () => {
		expect(
			unsubscribeTarget("<https://example.com/u/1>, <mailto:unsub@example.com?subject=stop>"),
		).toBe("mailto:unsub@example.com?subject=stop");
	});

	it("falls back to the https form", () => {
		expect(unsubscribeTarget("<https://example.com/u/1>")).toBe("https://example.com/u/1");
	});

	it("returns null without a header", () => {
		expect(unsubscribeTarget(undefined)).toBeNull();
	});
});
