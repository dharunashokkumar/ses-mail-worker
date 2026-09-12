/**
 * Filing rules. A rule is a set of conditions plus the actions to take when
 * they match; rules run in order inside the Durable Object when mail arrives.
 */

export type RuleField = "from" | "to" | "subject" | "body" | "list";
export type RuleOperator = "contains" | "equals" | "startsWith" | "endsWith";

export interface RuleCondition {
	field: RuleField;
	operator: RuleOperator;
	value: string;
}

export interface RuleActions {
	folder?: string;
	addLabels?: string[];
	markRead?: boolean;
	star?: boolean;
	pin?: boolean;
	category?: string;
	stop?: boolean;
}

export interface Rule {
	id: string;
	name: string;
	enabled: boolean;
	position: number;
	matchAll: boolean;
	conditions: RuleCondition[];
	actions: RuleActions;
}

export interface RuleCandidate {
	from: string;
	to: string;
	subject: string;
	body: string;
	list: string;
}

function fieldValue(candidate: RuleCandidate, field: RuleField): string {
	return (candidate[field] ?? "").toLowerCase();
}

function testCondition(
	candidate: RuleCandidate,
	condition: RuleCondition,
): boolean {
	const haystack = fieldValue(candidate, condition.field);
	const needle = condition.value.trim().toLowerCase();
	if (!needle) return false;
	switch (condition.operator) {
		case "equals":
			return haystack === needle;
		case "startsWith":
			return haystack.startsWith(needle);
		case "endsWith":
			return haystack.endsWith(needle);
		default:
			return haystack.includes(needle);
	}
}

export function ruleMatches(rule: Rule, candidate: RuleCandidate): boolean {
	if (!rule.enabled || rule.conditions.length === 0) return false;
	return rule.matchAll
		? rule.conditions.every((c) => testCondition(candidate, c))
		: rule.conditions.some((c) => testCondition(candidate, c));
}

/**
 * Run every rule in order and merge what they ask for. A rule with `stop: true`
 * ends the run, the way mail clients treat "stop evaluating rules".
 */
export function applyRules(
	rules: Rule[],
	candidate: RuleCandidate,
): RuleActions & { matched: string[] } {
	const merged: RuleActions & { matched: string[] } = {
		addLabels: [],
		matched: [],
	};
	const ordered = [...rules].sort((a, b) => a.position - b.position);

	for (const rule of ordered) {
		if (!ruleMatches(rule, candidate)) continue;
		merged.matched.push(rule.id);
		const { actions } = rule;
		if (actions.folder) merged.folder = actions.folder;
		if (actions.category) merged.category = actions.category;
		if (actions.markRead !== undefined) merged.markRead = actions.markRead;
		if (actions.star !== undefined) merged.star = actions.star;
		if (actions.pin !== undefined) merged.pin = actions.pin;
		for (const label of actions.addLabels ?? []) {
			if (!merged.addLabels?.includes(label)) merged.addLabels?.push(label);
		}
		if (actions.stop) break;
	}

	return merged;
}
