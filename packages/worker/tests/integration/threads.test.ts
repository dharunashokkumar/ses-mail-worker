import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { authenticatedFetch, mailboxId, testAuthBeforeAll } from "./utils";

function buildRawEmail(headers: Record<string, string>, body: string): string {
	let raw = "";
	for (const [key, value] of Object.entries(headers)) {
		raw += `${key}: ${value}\r\n`;
	}
	return `${raw}\r\n${body}`;
}

async function receive(rawEmailStr: string) {
	const worker = await import("../../dev/index");
	const rawBytes = new TextEncoder().encode(rawEmailStr);
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(rawBytes);
			controller.close();
		},
	});
	await worker.default.email(
		{ raw: stream, rawSize: rawBytes.length },
		env,
		createExecutionContext(),
	);
}

const api = (path: string) => `http://local.test/api/v1/mailboxes/${mailboxId}${path}`;

const json = (method: string, body: unknown) => ({
	method,
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(body),
});

describe("Threads API", () => {
	beforeEach(async () => {
		await testAuthBeforeAll();
		await authenticatedFetch("http://local.test/api/v1/debug/create-mailbox", {
			method: "POST",
		});

		await receive(
			buildRawEmail(
				{
					From: "Priya Raghavan <priya@kestrelhosting.io>",
					To: mailboxId,
					Subject: "Cutover window",
					"Message-ID": "<cutover-1@kestrelhosting.io>",
					"Content-Type": "text/plain",
					"Authentication-Results": "mx; spf=pass; dkim=pass; dmarc=pass",
				},
				"Thursday afternoon works for the cutover.",
			),
		);
		await receive(
			buildRawEmail(
				{
					From: "Priya Raghavan <priya@kestrelhosting.io>",
					To: mailboxId,
					Subject: "Re: Cutover window",
					"Message-ID": "<cutover-2@kestrelhosting.io>",
					"In-Reply-To": "<cutover-1@kestrelhosting.io>",
					References: "<cutover-1@kestrelhosting.io>",
					"Content-Type": "text/plain",
					"Authentication-Results": "mx; spf=pass; dkim=pass; dmarc=pass",
				},
				"One more thing about the rollback plan.",
			),
		);
		await receive(
			buildRawEmail(
				{
					From: "The Dispatch <editor@dispatch.example>",
					To: mailboxId,
					Subject: "Issue 214",
					"Message-ID": "<issue-214@dispatch.example>",
					"List-Id": "<dispatch.example>",
					"List-Unsubscribe": "<mailto:unsub@dispatch.example>",
					"Content-Type": "text/plain",
					"Authentication-Results": "mx; spf=pass; dkim=pass; dmarc=pass",
				},
				"This week: measuring CPU time instead of wall time.",
			),
		);
	});

	it("groups replies into one conversation", async () => {
		const response = await authenticatedFetch(api("/threads?folder=inbox"));
		expect(response.status).toBe(200);
		const { threads } = await response.json<any>();
		expect(threads).toHaveLength(2);

		const cutover = threads.find((t: any) => t.threadId === "cutover-1@kestrelhosting.io");
		expect(cutover.messageCount).toBe(2);
		expect(cutover.subject).toBe("Re: Cutover window");
		expect(cutover.unreadCount).toBe(2);
		expect(cutover.preview).toContain("rollback plan");
	});

	it("lists every message separately when conversations are off", async () => {
		const response = await authenticatedFetch(api("/threads?folder=inbox&conversations=false"));
		const { threads } = await response.json<any>();
		expect(threads).toHaveLength(3);
	});

	it("categorises list mail and records its unsubscribe target", async () => {
		const response = await authenticatedFetch(api("/threads?folder=inbox"));
		const { threads } = await response.json<any>();
		const newsletter = threads.find((t: any) => t.subject === "Issue 214");
		expect(newsletter.category).toBe("newsletters");
		expect(newsletter.listUnsubscribe).toBe("mailto:unsub@dispatch.example");
	});

	it("searches the full-text index and the operators", async () => {
		const words = await authenticatedFetch(api("/threads?q=rollback"));
		expect((await words.json<any>()).threads).toHaveLength(1);

		const sender = await authenticatedFetch(api("/threads?q=from:dispatch"));
		const senderThreads = (await sender.json<any>()).threads;
		expect(senderThreads).toHaveLength(1);
		expect(senderThreads[0].subject).toBe("Issue 214");

		const unread = await authenticatedFetch(api("/threads?q=is:unread"));
		expect((await unread.json<any>()).threads).toHaveLength(2);

		const none = await authenticatedFetch(api("/threads?q=has:attachment"));
		expect((await none.json<any>()).threads).toHaveLength(0);
	});

	it("returns every message in a thread", async () => {
		const response = await authenticatedFetch(
			api("/threads/cutover-1%40kestrelhosting.io"),
		);
		expect(response.status).toBe(200);
		const thread = await response.json<any>();
		expect(thread.messages).toHaveLength(2);
		expect(thread.messages[0].body).toContain("Thursday afternoon");
	});

	it("marks a thread read, flags it and moves it", async () => {
		const mutate = await authenticatedFetch(
			api("/threads/mutate"),
			json("POST", {
				threadIds: ["cutover-1@kestrelhosting.io"],
				read: true,
				starred: true,
			}),
		);
		expect((await mutate.json<any>()).changed).toBe(2);

		const listed = await authenticatedFetch(api("/threads?folder=inbox"));
		const cutover = (await listed.json<any>()).threads.find(
			(t: any) => t.threadId === "cutover-1@kestrelhosting.io",
		);
		expect(cutover.unread).toBe(false);
		expect(cutover.starred).toBe(true);

		await authenticatedFetch(
			api("/threads/mutate"),
			json("POST", { threadIds: ["cutover-1@kestrelhosting.io"], folderId: "archive" }),
		);
		const inbox = await authenticatedFetch(api("/threads?folder=inbox"));
		expect((await inbox.json<any>()).threads).toHaveLength(1);
		const archive = await authenticatedFetch(api("/threads?folder=archive"));
		expect((await archive.json<any>()).threads).toHaveLength(1);
	});

	it("snoozes a thread out of the inbox and back", async () => {
		const until = Date.now() + 60 * 60 * 1000;
		await authenticatedFetch(
			api("/threads/mutate"),
			json("POST", { threadIds: ["issue-214@dispatch.example"], snoozeUntil: until }),
		);

		const snoozed = await authenticatedFetch(api("/threads?folder=snoozed"));
		const snoozedThreads = (await snoozed.json<any>()).threads;
		expect(snoozedThreads).toHaveLength(1);
		expect(snoozedThreads[0].snoozedUntil).toBe(until);

		await authenticatedFetch(
			api("/threads/mutate"),
			json("POST", { threadIds: ["issue-214@dispatch.example"], snoozeUntil: null }),
		);
		const inbox = await authenticatedFetch(api("/threads?folder=inbox"));
		expect((await inbox.json<any>()).threads).toHaveLength(2);
	});

	it("labels threads and lists them by label", async () => {
		const created = await authenticatedFetch(
			api("/labels"),
			json("POST", { id: "work", name: "Work", color: "#2b74e8" }),
		);
		expect(created.status).toBe(201);

		await authenticatedFetch(
			api("/threads/mutate"),
			json("POST", {
				threadIds: ["cutover-1@kestrelhosting.io"],
				addLabels: ["work"],
			}),
		);

		const labelled = await authenticatedFetch(api("/threads?label=work"));
		const threads = (await labelled.json<any>()).threads;
		expect(threads).toHaveLength(1);
		expect(threads[0].labels).toEqual(["work"]);

		const byOperator = await authenticatedFetch(api("/threads?q=label:work"));
		expect((await byOperator.json<any>()).threads).toHaveLength(1);

		await authenticatedFetch(
			api("/threads/mutate"),
			json("POST", {
				threadIds: ["cutover-1@kestrelhosting.io"],
				removeLabels: ["work"],
			}),
		);
		const cleared = await authenticatedFetch(api("/threads?label=work"));
		expect((await cleared.json<any>()).threads).toHaveLength(0);
	});

	it("counts unread mail per folder and category", async () => {
		const response = await authenticatedFetch(api("/counts"));
		const counts = await response.json<any>();
		const inbox = counts.folders.find((f: any) => f.id === "inbox");
		expect(inbox.unread).toBe(3);
		expect(counts.folders.some((f: any) => f.id === "drafts")).toBe(true);
		expect(counts.categories.find((c: any) => c.id === "newsletters").total).toBe(1);
	});

	it("holds mail from a blocked sender in spam", async () => {
		await authenticatedFetch(
			api("/blocked"),
			json("POST", { address: "editor@dispatch.example" }),
		);
		const spam = await authenticatedFetch(api("/threads?folder=spam"));
		expect((await spam.json<any>()).threads).toHaveLength(1);

		await receive(
			buildRawEmail(
				{
					From: "editor@dispatch.example",
					To: mailboxId,
					Subject: "Issue 215",
					"Message-ID": "<issue-215@dispatch.example>",
					"Content-Type": "text/plain",
				},
				"Another issue.",
			),
		);
		const spamAgain = await authenticatedFetch(api("/threads?folder=spam"));
		expect((await spamAgain.json<any>()).threads).toHaveLength(2);
	});

	it("files mail with a rule", async () => {
		await authenticatedFetch(
			api("/labels"),
			json("POST", { id: "work", name: "Work" }),
		);
		await authenticatedFetch(
			api("/rules/kestrel"),
			json("PUT", {
				name: "Kestrel is work",
				enabled: true,
				position: 0,
				matchAll: true,
				conditions: [
					{ field: "from", operator: "endsWith", value: "@kestrelhosting.io" },
				],
				actions: { addLabels: ["work"], folder: "archive" },
			}),
		);

		await receive(
			buildRawEmail(
				{
					From: "priya@kestrelhosting.io",
					To: mailboxId,
					Subject: "Invoice for September",
					"Message-ID": "<inv-9@kestrelhosting.io>",
					"Content-Type": "text/plain",
				},
				"Attached.",
			),
		);

		const archive = await authenticatedFetch(api("/threads?folder=archive&label=work"));
		const threads = (await archive.json<any>()).threads;
		expect(threads).toHaveLength(1);
		expect(threads[0].subject).toBe("Invoice for September");
	});

	it("deletes a thread and its messages", async () => {
		await authenticatedFetch(
			api("/threads/delete"),
			json("POST", { threadIds: ["cutover-1@kestrelhosting.io"] }),
		);
		const inbox = await authenticatedFetch(api("/threads?folder=inbox"));
		expect((await inbox.json<any>()).threads).toHaveLength(1);
	});

	it("reports storage and AI budget", async () => {
		const response = await authenticatedFetch(api("/stats"));
		const stats = await response.json<any>();
		expect(stats.messages).toBe(3);
		expect(stats.ai.limit).toBe(10000);
		expect(stats.ai.available).toBe(true);
	});
});
