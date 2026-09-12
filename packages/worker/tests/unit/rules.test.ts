import { describe, expect, it } from "vitest";
import { applyRules, ruleMatches, type Rule } from "../../src/mail/rules";

const candidate = {
	from: "priya@kestrelhosting.io",
	to: "me@dharun.dev",
	subject: "Re: Cutover window",
	body: "Thursday afternoon works",
	list: "",
};

const rule = (overrides: Partial<Rule>): Rule => ({
	id: "r1",
	name: "Work mail",
	enabled: true,
	position: 0,
	matchAll: true,
	conditions: [{ field: "from", operator: "endsWith", value: "@kestrelhosting.io" }],
	actions: { addLabels: ["work"] },
	...overrides,
});

describe("ruleMatches", () => {
	it("matches on a sender domain", () => {
		expect(ruleMatches(rule({}), candidate)).toBe(true);
	});

	it("requires every condition when matchAll is set", () => {
		const r = rule({
			conditions: [
				{ field: "from", operator: "contains", value: "kestrel" },
				{ field: "subject", operator: "contains", value: "invoice" },
			],
		});
		expect(ruleMatches(r, candidate)).toBe(false);
		expect(ruleMatches({ ...r, matchAll: false }, candidate)).toBe(true);
	});

	it("never matches a disabled rule", () => {
		expect(ruleMatches(rule({ enabled: false }), candidate)).toBe(false);
	});
});

describe("applyRules", () => {
	it("merges the actions of every matching rule, in order", () => {
		const actions = applyRules(
			[
				rule({ id: "a", position: 1, actions: { addLabels: ["work"] } }),
				rule({
					id: "b",
					position: 0,
					conditions: [{ field: "subject", operator: "contains", value: "cutover" }],
					actions: { folder: "archive", star: true, addLabels: ["followup"] },
				}),
			],
			candidate,
		);
		expect(actions.matched).toEqual(["b", "a"]);
		expect(actions.folder).toBe("archive");
		expect(actions.star).toBe(true);
		expect(actions.addLabels).toEqual(["followup", "work"]);
	});

	it("stops at a rule that asks to stop", () => {
		const actions = applyRules(
			[
				rule({ id: "a", position: 0, actions: { folder: "archive", stop: true } }),
				rule({ id: "b", position: 1, actions: { folder: "trash" } }),
			],
			candidate,
		);
		expect(actions.matched).toEqual(["a"]);
		expect(actions.folder).toBe("archive");
	});
});

describe("malformed rules", () => {
	it("does not match, and does not throw, on a broken condition list", () => {
		const broken = rule({ conditions: undefined as any });
		expect(() => ruleMatches(broken, candidate)).not.toThrow();
		expect(ruleMatches(broken, candidate)).toBe(false);
	});

	it("ignores a condition whose value is not text", () => {
		const broken = rule({
			conditions: [{ field: "from", operator: "contains", value: 42 as any }],
		});
		expect(ruleMatches(broken, candidate)).toBe(false);
	});

	it("survives a rule list that is not an array", () => {
		expect(applyRules(undefined as any, candidate).matched).toEqual([]);
	});
});
