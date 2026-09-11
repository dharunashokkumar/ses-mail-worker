/**
 * The mail API the dashboard runs on.
 *
 * These are plain Hono handlers rather than chanfana route classes: they do no
 * work of their own beyond validating input and calling the Durable Object,
 * which is what keeps the Worker inside the free plan's 10 ms CPU budget.
 */

import type { Hono } from "hono";
import { sendOutboundEmail } from "../outbound";
import type { Env } from "../types";

/**
 * Hono infers a route type per handler; with this many routes that inference
 * blows past TypeScript's instantiation depth, so the app is taken loosely and
 * each handler types its own context.
 */
type App = Hono<any, any, any>;

const DEFAULT_WORKER_NAME = "email-explorer";

/**
 * The Durable Object methods these routes call.
 *
 * Declared here rather than inferred from the class: resolving the RPC type of
 * a Durable Object with this many methods exceeds TypeScript's instantiation
 * depth at every call site.
 */
interface MailboxStub {
	listThreads(options: Record<string, unknown>): Promise<unknown>;
	getThread(threadId: string): Promise<{ messages: any[] } | null>;
	mutate(input: Record<string, unknown>): Promise<unknown>;
	deleteMessages(input: { ids?: string[]; threadIds?: string[] }): Promise<{
		deleted: number;
		attachments: Array<{ id: string; email_id: string; filename: string }>;
	}>;
	getCounts(): Promise<unknown>;
	getStats(): Promise<unknown>;
	exportBatch(offset: number, limit: number): Promise<unknown>;
	getLabels(): Promise<unknown>;
	createLabel(input: {
		id?: string;
		name: string;
		color?: string;
	}): Promise<unknown>;
	updateLabel(id: string, input: Record<string, unknown>): Promise<unknown>;
	deleteLabel(id: string): Promise<unknown>;
	getRules(): Promise<unknown>;
	putRule(rule: Record<string, unknown>): Promise<unknown>;
	deleteRule(id: string): Promise<unknown>;
	getBlockedSenders(): Promise<string[]>;
	blockSender(address: string): Promise<unknown>;
	unblockSender(address: string): Promise<unknown>;
	getTemplates(): Promise<unknown>;
	putTemplate(template: Record<string, unknown>): Promise<unknown>;
	deleteTemplate(id: string): Promise<unknown>;
	getSavedSearches(): Promise<unknown>;
	putSavedSearch(search: Record<string, unknown>): Promise<unknown>;
	deleteSavedSearch(id: string): Promise<unknown>;
	getMailboxSettings(): Promise<unknown>;
	putMailboxSettings(settings: Record<string, unknown>): Promise<unknown>;
	saveDraft(
		input: Record<string, unknown>,
	): Promise<{ id: string; scheduledAt: number | null }>;
	cancelScheduled(id: string): Promise<unknown>;
	recordSent(input: Record<string, unknown>): Promise<unknown>;
	updateDelivery(
		messageId: string,
		state: string,
		detail: string,
	): Promise<unknown>;
	summarizeThread(threadId: string): Promise<unknown>;
	rewriteDraft(text: string, tone: string): Promise<unknown>;
	fetch(request: Request): Promise<Response>;
}

function stub(env: Env, mailboxId: string): MailboxStub {
	return env.MAILBOX.get(
		env.MAILBOX.idFromName(mailboxId),
	) as unknown as MailboxStub;
}

async function mailboxExists(env: Env, mailboxId: string): Promise<boolean> {
	return Boolean(await env.BUCKET.head(`mailboxes/${mailboxId}.json`));
}

function asArray(value: unknown): string[] {
	if (Array.isArray(value))
		return value.map((item) => String(item).trim()).filter(Boolean);
	if (typeof value === "string" && value.trim()) {
		return value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return [];
}

function bool(value: unknown, fallback: boolean): boolean {
	if (value === undefined || value === null || value === "") return fallback;
	return value === true || value === "true" || value === "1";
}

export function registerMailRoutes(app: App) {
	/** Who the dashboard is talking to, and how it authenticated. */
	app.get("/api/v1/identity", async (c: any) => {
		const session = c.get("session");
		const mode =
			c.env.AUTH_MODE?.trim().toLowerCase() === "access" ? "access" : "session";
		return c.json({
			mode,
			email: session?.email ?? null,
			isAdmin: session?.isAdmin ?? false,
			domain: c.env.MAIL_DOMAIN ?? null,
			addressManagement: Boolean(
				c.env.CLOUDFLARE_API_TOKEN && c.env.CLOUDFLARE_ZONE_ID,
			),
			ai: Boolean((c.env as any).AI),
		});
	});

	// --- reading ------------------------------------------------------------

	app.get("/api/v1/mailboxes/:mailboxId/threads", async (c: any) => {
		const mailboxId = c.req.param("mailboxId");
		if (!(await mailboxExists(c.env, mailboxId)))
			return c.json({ error: "Not found" }, 404);
		const result = await stub(c.env, mailboxId).listThreads({
			folder: c.req.query("folder") || undefined,
			labelId: c.req.query("label") || undefined,
			category: c.req.query("category") || undefined,
			query: c.req.query("q") || undefined,
			page: Number(c.req.query("page") ?? 1) || 1,
			limit: Number(c.req.query("limit") ?? 50) || 50,
			conversations: bool(c.req.query("conversations"), true),
			unreadOnly: bool(c.req.query("unread"), false),
			flaggedOnly: bool(c.req.query("flagged"), false),
			includeSpam: bool(c.req.query("includeSpam"), false),
		});
		return c.json(result);
	});

	app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: any) => {
		const mailboxId = c.req.param("mailboxId");
		const thread = await stub(c.env, mailboxId).getThread(
			decodeURIComponent(c.req.param("threadId")),
		);
		if (!thread) return c.json({ error: "Not found" }, 404);
		return c.json(thread);
	});

	app.post("/api/v1/mailboxes/:mailboxId/threads/mutate", async (c: any) => {
		const body = await c.req.json();
		const result = await stub(c.env, c.req.param("mailboxId")).mutate({
			ids: body.ids,
			threadIds: body.threadIds,
			read: body.read,
			starred: body.starred,
			pinned: body.pinned,
			folderId: body.folderId,
			category: body.category,
			addLabels: body.addLabels,
			removeLabels: body.removeLabels,
			snoozeUntil: body.snoozeUntil,
			remindAt: body.remindAt,
		});
		return c.json(result);
	});

	app.post("/api/v1/mailboxes/:mailboxId/threads/delete", async (c: any) => {
		const body = await c.req.json();
		const mailboxId = c.req.param("mailboxId");
		const result = await stub(c.env, mailboxId).deleteMessages({
			ids: body.ids,
			threadIds: body.threadIds,
		});
		// Attachment objects go with the messages they belonged to.
		for (const attachment of result.attachments) {
			await c.env.BUCKET.delete(
				`attachments/${attachment.email_id}/${attachment.id}/${attachment.filename}`,
			);
		}
		return c.json({ deleted: result.deleted });
	});

	app.get("/api/v1/mailboxes/:mailboxId/counts", async (c: any) =>
		c.json(await stub(c.env, c.req.param("mailboxId")).getCounts()),
	);

	app.get("/api/v1/mailboxes/:mailboxId/stats", async (c: any) =>
		c.json(await stub(c.env, c.req.param("mailboxId")).getStats()),
	);

	app.get("/api/v1/mailboxes/:mailboxId/export", async (c: any) => {
		const rows = await stub(c.env, c.req.param("mailboxId")).exportBatch(
			Number(c.req.query("offset") ?? 0) || 0,
			Number(c.req.query("limit") ?? 50) || 50,
		);
		return c.json(rows);
	});

	// --- labels --------------------------------------------------------------

	app.get("/api/v1/mailboxes/:mailboxId/labels", async (c: any) =>
		c.json(await stub(c.env, c.req.param("mailboxId")).getLabels()),
	);

	app.post("/api/v1/mailboxes/:mailboxId/labels", async (c: any) => {
		const body = await c.req.json();
		if (!body?.name) return c.json({ error: "name is required" }, 400);
		return c.json(
			await stub(c.env, c.req.param("mailboxId")).createLabel({
				id: body.id,
				name: body.name,
				color: body.color,
			}),
			201,
		);
	});

	app.put("/api/v1/mailboxes/:mailboxId/labels/:id", async (c: any) => {
		const body = await c.req.json();
		const label = await stub(c.env, c.req.param("mailboxId")).updateLabel(
			c.req.param("id"),
			body,
		);
		return label ? c.json(label) : c.json({ error: "Not found" }, 404);
	});

	app.delete("/api/v1/mailboxes/:mailboxId/labels/:id", async (c: any) => {
		await stub(c.env, c.req.param("mailboxId")).deleteLabel(c.req.param("id"));
		return c.json({ status: "deleted" });
	});

	// --- rules, blocklist, templates, saved searches ---------------------------

	app.get("/api/v1/mailboxes/:mailboxId/rules", async (c: any) =>
		c.json(await stub(c.env, c.req.param("mailboxId")).getRules()),
	);

	app.put("/api/v1/mailboxes/:mailboxId/rules/:id", async (c: any) => {
		const body = await c.req.json();
		return c.json(
			await stub(c.env, c.req.param("mailboxId")).putRule({
				...body,
				id: c.req.param("id"),
			}),
		);
	});

	app.delete("/api/v1/mailboxes/:mailboxId/rules/:id", async (c: any) => {
		await stub(c.env, c.req.param("mailboxId")).deleteRule(c.req.param("id"));
		return c.json({ status: "deleted" });
	});

	app.get("/api/v1/mailboxes/:mailboxId/blocked", async (c: any) =>
		c.json(await stub(c.env, c.req.param("mailboxId")).getBlockedSenders()),
	);

	app.post("/api/v1/mailboxes/:mailboxId/blocked", async (c: any) => {
		const body = await c.req.json();
		if (!body?.address) return c.json({ error: "address is required" }, 400);
		return c.json(
			await stub(c.env, c.req.param("mailboxId")).blockSender(
				String(body.address),
			),
			201,
		);
	});

	app.delete(
		"/api/v1/mailboxes/:mailboxId/blocked/:address",
		async (c: any) => {
			await stub(c.env, c.req.param("mailboxId")).unblockSender(
				decodeURIComponent(c.req.param("address")),
			);
			return c.json({ status: "deleted" });
		},
	);

	app.get("/api/v1/mailboxes/:mailboxId/templates", async (c: any) =>
		c.json(await stub(c.env, c.req.param("mailboxId")).getTemplates()),
	);

	app.put("/api/v1/mailboxes/:mailboxId/templates/:id", async (c: any) => {
		const body = await c.req.json();
		return c.json(
			await stub(c.env, c.req.param("mailboxId")).putTemplate({
				...body,
				id: c.req.param("id"),
			}),
		);
	});

	app.delete("/api/v1/mailboxes/:mailboxId/templates/:id", async (c: any) => {
		await stub(c.env, c.req.param("mailboxId")).deleteTemplate(
			c.req.param("id"),
		);
		return c.json({ status: "deleted" });
	});

	app.get("/api/v1/mailboxes/:mailboxId/saved-searches", async (c: any) =>
		c.json(await stub(c.env, c.req.param("mailboxId")).getSavedSearches()),
	);

	app.put("/api/v1/mailboxes/:mailboxId/saved-searches/:id", async (c: any) => {
		const body = await c.req.json();
		return c.json(
			await stub(c.env, c.req.param("mailboxId")).putSavedSearch({
				...body,
				id: c.req.param("id"),
			}),
		);
	});

	app.delete(
		"/api/v1/mailboxes/:mailboxId/saved-searches/:id",
		async (c: any) => {
			await stub(c.env, c.req.param("mailboxId")).deleteSavedSearch(
				c.req.param("id"),
			);
			return c.json({ status: "deleted" });
		},
	);

	app.get("/api/v1/mailboxes/:mailboxId/preferences", async (c: any) =>
		c.json(await stub(c.env, c.req.param("mailboxId")).getMailboxSettings()),
	);

	app.put("/api/v1/mailboxes/:mailboxId/preferences", async (c: any) => {
		const body = await c.req.json();
		return c.json(
			await stub(c.env, c.req.param("mailboxId")).putMailboxSettings(
				body ?? {},
			),
		);
	});

	// --- composing ------------------------------------------------------------

	app.post("/api/v1/mailboxes/:mailboxId/drafts", async (c: any) => {
		const body = await c.req.json();
		const mailboxId = c.req.param("mailboxId");
		return c.json(
			await stub(c.env, mailboxId).saveDraft({
				id: body.id,
				from: body.from || mailboxId,
				to: asArray(body.to),
				cc: asArray(body.cc),
				bcc: asArray(body.bcc),
				subject: body.subject,
				html: body.html,
				inReplyTo: body.inReplyTo ?? null,
				references: body.references ?? null,
				threadId: body.threadId ?? null,
				scheduledAt: body.scheduledAt ?? null,
			}),
		);
	});

	app.delete("/api/v1/mailboxes/:mailboxId/drafts/:id", async (c: any) => {
		await stub(c.env, c.req.param("mailboxId")).deleteMessages({
			ids: [c.req.param("id")],
		});
		return c.json({ status: "deleted" });
	});

	app.post(
		"/api/v1/mailboxes/:mailboxId/drafts/:id/cancel-schedule",
		async (c: any) => {
			await stub(c.env, c.req.param("mailboxId")).cancelScheduled(
				c.req.param("id"),
			);
			return c.json({ status: "cancelled" });
		},
	);

	/**
	 * Send, or schedule. Handles recipients, Cc/Bcc, attachments, threading
	 * headers, the draft it came from and an optional follow-up reminder.
	 */
	app.post("/api/v1/mailboxes/:mailboxId/messages", async (c: any) => {
		const mailboxId = c.req.param("mailboxId");
		if (!(await mailboxExists(c.env, mailboxId)))
			return c.json({ error: "Not found" }, 404);
		const body = await c.req.json();

		const to = asArray(body.to);
		const cc = asArray(body.cc);
		const bcc = asArray(body.bcc);
		if (to.length === 0 && cc.length === 0 && bcc.length === 0) {
			return c.json({ error: "At least one recipient is required" }, 400);
		}
		const from = String(body.from || mailboxId);
		const subject = String(body.subject ?? "");
		const html = body.html ? String(body.html) : undefined;
		const text = body.text ? String(body.text) : undefined;
		if (!html && !text)
			return c.json({ error: "Either html or text is required" }, 400);

		const mailbox = stub(c.env, mailboxId);

		// Scheduled mail is stored and sent later by the Durable Object's alarm.
		if (body.scheduledAt) {
			const draft = await mailbox.saveDraft({
				id: body.draftId,
				from,
				to,
				cc,
				bcc,
				subject,
				html: html ?? text ?? "",
				inReplyTo: body.inReplyTo ?? null,
				references: body.references ?? null,
				threadId: body.threadId ?? null,
				scheduledAt: Number(body.scheduledAt),
			});
			return c.json(
				{ id: draft.id, status: "scheduled", scheduledAt: draft.scheduledAt },
				201,
			);
		}

		let sent: { messageId: string | null };
		try {
			sent = await sendOutboundEmail(c.env, {
				from,
				to: [...to, ...cc, ...bcc],
				subject,
				html,
				text,
				attachments: body.attachments,
				inReplyTo: body.inReplyTo || undefined,
				references: body.references || undefined,
			});
		} catch (error) {
			return c.json({ error: (error as Error).message }, 500);
		}

		const messageId = sent.messageId ?? crypto.randomUUID();

		const attachmentRows = [];
		for (const attachment of body.attachments ?? []) {
			const attachmentId = crypto.randomUUID();
			const decoded = atob(String(attachment.content ?? ""));
			const bytes = new Uint8Array(decoded.length);
			for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
			await c.env.BUCKET.put(
				`attachments/${messageId}/${attachmentId}/${attachment.filename}`,
				bytes,
			);
			attachmentRows.push({
				id: attachmentId,
				filename: attachment.filename,
				mimetype: attachment.type ?? "application/octet-stream",
				size: bytes.byteLength,
				content_id: attachment.contentId ?? null,
				disposition: attachment.disposition ?? "attachment",
			});
		}

		await mailbox.recordSent({
			id: messageId,
			from,
			to,
			cc,
			bcc,
			subject,
			html,
			text,
			inReplyTo: body.inReplyTo ?? null,
			references: body.references ?? null,
			threadId: body.threadId ?? null,
			attachments: attachmentRows,
			remindAt: body.remindAt ?? null,
		});

		if (body.draftId) {
			await mailbox.deleteMessages({ ids: [String(body.draftId)] });
		}

		return c.json({ id: messageId, status: "sent" }, 201);
	});

	// --- one-click unsubscribe --------------------------------------------------

	app.post("/api/v1/mailboxes/:mailboxId/unsubscribe", async (c: any) => {
		const mailboxId = c.req.param("mailboxId");
		const body = await c.req.json();
		const thread = await stub(c.env, mailboxId).getThread(
			String(body.threadId ?? ""),
		);
		const latest = thread?.messages?.[thread.messages.length - 1] as any;
		const target = latest?.list_unsubscribe
			? String(latest.list_unsubscribe)
			: null;
		if (!target)
			return c.json({ error: "This sender offers no unsubscribe link" }, 400);

		if (target.toLowerCase().startsWith("mailto:")) {
			const address = target.slice(7).split("?")[0];
			const subjectMatch = target.match(/subject=([^&]+)/i);
			try {
				await sendOutboundEmail(c.env, {
					from: mailboxId,
					to: address,
					subject: subjectMatch
						? decodeURIComponent(subjectMatch[1])
						: "unsubscribe",
					text: "Please unsubscribe this address.",
				});
			} catch (error) {
				return c.json({ error: (error as Error).message }, 500);
			}
			return c.json({ status: "sent", method: "mailto", target: address });
		}

		// An HTTP target is opened by the browser: the Worker does not follow it.
		return c.json({ status: "open", method: "http", target });
	});

	// --- Workers AI ---------------------------------------------------------------

	app.post(
		"/api/v1/mailboxes/:mailboxId/threads/:threadId/summarize",
		async (c: any) =>
			c.json(
				await stub(c.env, c.req.param("mailboxId")).summarizeThread(
					decodeURIComponent(c.req.param("threadId")),
				),
			),
	);

	app.post("/api/v1/mailboxes/:mailboxId/ai/rewrite", async (c: any) => {
		const body = await c.req.json();
		return c.json(
			await stub(c.env, c.req.param("mailboxId")).rewriteDraft(
				String(body.text ?? ""),
				String(body.tone ?? "clear and friendly, in British English"),
			),
		);
	});

	// --- live updates ---------------------------------------------------------------

	app.get("/api/v1/mailboxes/:mailboxId/live", async (c: any) => {
		if (c.req.raw.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return c.json({ error: "Expected a WebSocket upgrade" }, 426);
		}
		return stub(c.env, c.req.param("mailboxId")).fetch(c.req.raw);
	});

	// --- addresses on the domain (Cloudflare Email Routing) --------------------------

	app.get("/api/v1/addresses", async (c: any) => {
		const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID } = c.env;
		if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) {
			return c.json({ managed: false, addresses: [] });
		}
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/email/routing/rules?per_page=200`,
			{ headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } },
		);
		const payload = (await response.json()) as any;
		if (!response.ok || !payload?.success) {
			return c.json(
				{
					managed: false,
					error: payload?.errors?.[0]?.message ?? "Cloudflare API error",
				},
				502,
			);
		}
		const addresses = (payload.result ?? [])
			.filter((rule: any) => rule.matchers?.[0]?.field === "to")
			.map((rule: any) => ({
				id: rule.tag,
				address: rule.matchers[0].value,
				enabled: rule.enabled,
				action: rule.actions?.[0]?.type ?? "unknown",
			}));
		return c.json({ managed: true, addresses });
	});

	app.post("/api/v1/addresses", async (c: any) => {
		const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, MAIL_DOMAIN } = c.env;
		if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID || !MAIL_DOMAIN) {
			return c.json(
				{
					error:
						"Address management needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID and MAIL_DOMAIN",
				},
				400,
			);
		}
		const body = await c.req.json();
		const local = String(body.local ?? "")
			.trim()
			.toLowerCase();
		if (!/^[a-z0-9._-]{1,64}$/.test(local)) {
			return c.json(
				{ error: "Use letters, digits, dots, dashes or underscores" },
				400,
			);
		}
		const address = `${local}@${MAIL_DOMAIN}`;
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/email/routing/rules`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					name: `Mail for ${address}`,
					enabled: true,
					matchers: [{ type: "literal", field: "to", value: address }],
					actions: [
						{
							type: "worker",
							value: [String(body.worker ?? DEFAULT_WORKER_NAME)],
						},
					],
				}),
			},
		);
		const payload = (await response.json()) as any;
		if (!response.ok || !payload?.success) {
			return c.json(
				{ error: payload?.errors?.[0]?.message ?? "Cloudflare API error" },
				502,
			);
		}
		// The mailbox exists once its marker object does.
		await c.env.BUCKET.put(
			`mailboxes/${address}.json`,
			JSON.stringify({ name: local, createdAt: Date.now() }),
		);
		return c.json({ address, id: payload.result?.tag }, 201);
	});
}

/**
 * Amazon SES delivery notifications, delivered by SNS.
 *
 * Public by design — SNS cannot authenticate — so it is guarded by a shared
 * token in the query string and only ever updates delivery state.
 */
export function registerWebhookRoutes(app: App) {
	app.post("/api/v1/webhooks/ses", async (c: any) => {
		const expected = c.env.SES_WEBHOOK_TOKEN?.trim();
		if (!expected || c.req.query("token") !== expected) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const payload = (await c.req.json().catch(() => null)) as any;
		if (!payload) return c.json({ error: "Invalid payload" }, 400);

		// SNS asks us to confirm the subscription once.
		if (payload.Type === "SubscriptionConfirmation" && payload.SubscribeURL) {
			await fetch(String(payload.SubscribeURL));
			return c.json({ status: "subscribed" });
		}

		const event =
			typeof payload.Message === "string"
				? JSON.parse(payload.Message)
				: (payload.Message ?? payload);
		const type = String(
			event.eventType ?? event.notificationType ?? "",
		).toLowerCase();
		const messageId = String(event.mail?.messageId ?? "");
		const source = String(event.mail?.source ?? "").toLowerCase();
		if (!messageId || !source) return c.json({ status: "ignored" });

		const detail = (() => {
			switch (type) {
				case "delivery":
					return `Delivered to ${(event.delivery?.recipients ?? []).join(", ")}`;
				case "bounce":
					return `Bounced: ${event.bounce?.bouncedRecipients?.[0]?.diagnosticCode ?? event.bounce?.bounceType ?? "unknown"}`;
				case "complaint":
					return "Marked as spam by the recipient";
				case "open":
					return "Opened by the recipient";
				case "click":
					return "A link was clicked";
				case "reject":
					return `Rejected: ${event.reject?.reason ?? "unknown"}`;
				default:
					return `Provider event: ${type || "unknown"}`;
			}
		})();

		const state =
			type === "delivery"
				? "delivered"
				: type === "bounce"
					? "bounced"
					: type === "complaint"
						? "complained"
						: type === "reject"
							? "failed"
							: type === "open" || type === "click"
								? "opened"
								: "accepted";

		await stub(c.env, source).updateDelivery(messageId, state, detail);
		return c.json({ status: "recorded" });
	});
}
