import { DurableObject } from "cloudflare:workers";
import PostalMime from "postal-mime";
import { DOQB } from "workers-qb";
import {
	categorise,
	headerBag,
	parseAuthResults,
	spamVerdict,
	unsubscribeTarget,
} from "../mail/classify";
import { applyRules, type Rule } from "../mail/rules";
import { parseSearchQuery } from "../mail/search-query";
import {
	addressList,
	displayName,
	htmlToText,
	previewOf,
	safeKeySegment,
	stripBrackets,
} from "../mail/text";
import type { Env, Session, User } from "../types";
import { authMigrations, mailboxMigrations } from "./migrations";

/** Workers AI free tier: 10,000 neurons a day, then the model errors. */
const AI_DAILY_NEURONS = 10_000;
/** Llama 3.2 3B costs roughly 14 neurons for a thread summary. */
const AI_NEURONS_PER_CALL = 14;
const AI_MODEL = "@cf/meta/llama-3.2-3b-instruct";

export interface ThreadQuery {
	folder?: string;
	labelId?: string;
	category?: string;
	query?: string;
	page?: number;
	limit?: number;
	conversations?: boolean;
	unreadOnly?: boolean;
	flaggedOnly?: boolean;
	includeSpam?: boolean;
}

export interface ThreadSummary {
	threadId: string;
	id: string;
	folderId: string;
	subject: string;
	sender: string;
	recipient: string;
	cc: string | null;
	date: string;
	preview: string;
	unread: boolean;
	unreadCount: number;
	starred: boolean;
	pinned: boolean;
	hasAttachments: boolean;
	messageCount: number;
	labels: string[];
	category: string | null;
	snoozedUntil: number | null;
	scheduledAt: number | null;
	deliveryState: string | null;
	deliveryDetail: string | null;
	listUnsubscribe: string | null;
	spamReason: string | null;
	summary: string | null;
	participants: string[];
}

export interface MutateInput {
	ids?: string[];
	threadIds?: string[];
	read?: boolean;
	starred?: boolean;
	pinned?: boolean;
	folderId?: string;
	category?: string | null;
	addLabels?: string[];
	removeLabels?: string[];
	snoozeUntil?: number | null;
	remindAt?: number | null;
}

const ALLOWED_SORT_COLUMNS = [
	"id",
	"subject",
	"sender",
	"recipient",
	"date",
	"read",
	"starred",
] as const;

type SortColumn = (typeof ALLOWED_SORT_COLUMNS)[number];

interface GetEmailsOptions {
	folder?: string;
	page?: number;
	limit?: number;
	sortColumn?: SortColumn;
	sortDirection?: "ASC" | "DESC";
}

interface EmailData {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	date: string;
	body: string;
	read?: boolean;
	starred?: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
}

interface AttachmentData {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

export class MailboxDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;
	#qb: DOQB;
	#isAuthDO: boolean;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.#qb = new DOQB(this.ctx.storage.sql);
		// this.#qb.setDebugger(true);

		// Detect if this is the auth singleton
		// We use a marker in storage to identify the auth DO
		const authMarker = this.ctx.storage.sql
			.exec(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
			)
			.toArray();
		const hasAuthTables = authMarker.length > 0;

		// Check if this is first initialization
		const isFirstInit =
			this.ctx.storage.sql
				.exec(
					"SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'",
				)
				.toArray().length === 0;

		// If first init, check the ID to determine type
		// idFromName creates deterministic IDs, so we check if this ID matches the expected AUTH ID
		if (isFirstInit) {
			// Create a test ID to compare
			const testAuthId = env.MAILBOX.idFromName("AUTH");
			this.#isAuthDO = this.ctx.id.equals(testAuthId);
		} else {
			// On subsequent loads, check if auth tables exist
			this.#isAuthDO = hasAuthTables;
		}

		// Apply appropriate migrations
		if (this.#isAuthDO) {
			this.#qb.migrations({ migrations: authMigrations }).apply();
		} else {
			this.#qb.migrations({ migrations: mailboxMigrations }).apply();
		}
	}

	// Auth helper: hash password using Web Crypto API
	async #hashPassword(password: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(password);
		const hash = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hash));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	// Auth helper: verify password
	async #verifyPassword(password: string, hash: string): Promise<boolean> {
		const passwordHash = await this.#hashPassword(password);
		return passwordHash === hash;
	}

	// Auth helper: generate session token
	#generateToken(): string {
		return crypto.randomUUID();
	}

	// Auth operation: check if any users exist
	async hasUsers(): Promise<boolean> {
		if (!this.#isAuthDO) return false;
		const result = this.#qb.select("users").fields(["COUNT(*) as count"]).one();
		return (result.results?.count as number) > 0;
	}

	// Auth operation: check if user is admin
	async isAdmin(userId: string): Promise<boolean> {
		if (!this.#isAuthDO) return false;
		const result = this.#qb
			.select("users")
			.fields(["is_admin"])
			.where("id = ?", userId)
			.one();
		return result.results?.is_admin === 1;
	}

	// Auth operation: register a user
	async register(
		email: string,
		password: string,
		isFirstUser = false,
	): Promise<User> {
		if (!this.#isAuthDO) throw new Error("Not an auth DO");

		const userId = crypto.randomUUID();
		const passwordHash = await this.#hashPassword(password);
		const now = Date.now();

		this.#qb
			.insert({
				tableName: "users",
				data: {
					id: userId,
					email,
					password_hash: passwordHash,
					is_admin: isFirstUser ? 1 : 0,
					created_at: now,
					updated_at: now,
				},
			})
			.execute();

		return {
			id: userId,
			email,
			isAdmin: isFirstUser,
			createdAt: now,
			updatedAt: now,
		};
	}

	// Auth operation: login
	async login(email: string, password: string): Promise<Session | null> {
		if (!this.#isAuthDO) throw new Error("Not an auth DO");

		const result = this.#qb
			.select("users")
			.fields(["id", "email", "password_hash", "is_admin"])
			.where("email = ?", email)
			.one();

		if (!result.results) return null;

		const user = result.results;
		const isValid = await this.#verifyPassword(
			password,
			String(user.password_hash),
		);

		if (!isValid) return null;

		// Create session (30 days expiry)
		const sessionId = this.#generateToken();
		const now = Date.now();
		const expiresAt = now + 30 * 24 * 60 * 60 * 1000;

		this.#qb
			.insert({
				tableName: "sessions",
				data: {
					id: sessionId,
					user_id: String(user.id),
					expires_at: expiresAt,
					created_at: now,
				},
			})
			.execute();

		return {
			id: sessionId,
			userId: String(user.id),
			email: String(user.email),
			isAdmin: user.is_admin === 1,
			expiresAt,
		};
	}

	// Auth operation: validate session
	async validateSession(sessionId: string): Promise<Session | null> {
		if (!this.#isAuthDO) throw new Error("Not an auth DO");

		const result = this.#qb
			.select("sessions")
			.fields(["id", "user_id", "expires_at"])
			.where("id = ?", sessionId)
			.one();

		if (!result.results) return null;

		const session = result.results;
		const expiresAt = Number(session.expires_at);

		// Check if expired
		if (expiresAt < Date.now()) {
			this.#qb
				.delete({
					tableName: "sessions",
					where: {
						conditions: "id = ?",
						params: [sessionId],
					},
				})
				.execute();
			return null;
		}

		// Get user info
		const userResult = this.#qb
			.select("users")
			.fields(["email", "is_admin"])
			.where("id = ?", String(session.user_id))
			.one();

		if (!userResult.results) return null;

		return {
			id: String(session.id),
			userId: String(session.user_id),
			email: String(userResult.results.email),
			isAdmin: userResult.results.is_admin === 1,
			expiresAt,
		};
	}

	// Auth operation: logout
	async logout(sessionId: string): Promise<boolean> {
		if (!this.#isAuthDO) throw new Error("Not an auth DO");

		this.#qb
			.delete({
				tableName: "sessions",
				where: {
					conditions: "id = ?",
					params: [sessionId],
				},
			})
			.execute();

		return true;
	}

	// Auth operation: get all users (admin only)
	async getUsers(): Promise<User[]> {
		if (!this.#isAuthDO) throw new Error("Not an auth DO");

		const result = this.#qb
			.select("users")
			.fields(["id", "email", "is_admin", "created_at", "updated_at"])
			.execute();

		return (
			result.results?.map((user) => ({
				id: String(user.id),
				email: String(user.email),
				isAdmin: user.is_admin === 1,
				createdAt: Number(user.created_at),
				updatedAt: Number(user.updated_at),
			})) ?? []
		);
	}

	// Auth operation: get user by email
	async getUserByEmail(email: string): Promise<User | null> {
		if (!this.#isAuthDO) throw new Error("Not an auth DO");

		const result = this.#qb
			.select("users")
			.fields(["id", "email", "is_admin", "created_at", "updated_at"])
			.where("email = ?", email)
			.execute();

		if (!result.results || result.results.length === 0) {
			return null;
		}

		const user = result.results[0];
		return {
			id: String(user.id),
			email: String(user.email),
			isAdmin: user.is_admin === 1,
			createdAt: Number(user.created_at),
			updatedAt: Number(user.updated_at),
		};
	}

	// Auth operation: update user password
	async updateUserPassword(userId: string, newPassword: string): Promise<void> {
		if (!this.#isAuthDO) throw new Error("Not an auth DO");

		const hashedPassword = await this.#hashPassword(newPassword);

		this.#qb
			.update({
				tableName: "users",
				data: {
					password_hash: hashedPassword,
					updated_at: Date.now(),
				},
				where: {
					conditions: "id = ?",
					params: [userId],
				},
			})
			.execute();
	}

	// Auth operation: grant mailbox access
	async grantMailboxAccess(
		userId: string,
		mailboxId: string,
		role: string,
	): Promise<void> {
		if (!this.#isAuthDO) throw new Error("Not an auth DO");

		this.#qb
			.insert({
				tableName: "user_mailboxes",
				data: {
					user_id: userId,
					mailbox_id: mailboxId,
					role,
				},
			})
			.execute();
	}

	// Auth operation: revoke mailbox access
	async revokeMailboxAccess(userId: string, mailboxId: string): Promise<void> {
		if (!this.#isAuthDO) throw new Error("Not an auth DO");

		this.#qb
			.delete({
				tableName: "user_mailboxes",
				where: {
					conditions: "user_id = ? AND mailbox_id = ?",
					params: [userId, mailboxId],
				},
			})
			.execute();
	}

	// Auth operation: get user mailboxes
	async getUserMailboxes(
		userId: string,
	): Promise<Array<{ mailboxId: string; role: string }>> {
		if (!this.#isAuthDO) throw new Error("Not an auth DO");

		const result = this.#qb
			.select("user_mailboxes")
			.fields(["mailbox_id", "role"])
			.where("user_id = ?", userId)
			.execute();

		return (
			result.results?.map((row) => ({
				mailboxId: String(row.mailbox_id),
				role: String(row.role),
			})) ?? []
		);
	}

	async getEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			page = 1,
			limit = 25,
			sortColumn: rawSortColumn = "date",
			sortDirection = "DESC",
		} = options;

		const sortColumn: SortColumn = ALLOWED_SORT_COLUMNS.includes(
			rawSortColumn as SortColumn,
		)
			? rawSortColumn
			: "date";

		let query = this.#qb
			.select<EmailData>("emails")
			.fields([
				"id",
				"subject",
				"sender",
				"recipient",
				"date",
				"read",
				"starred",
				"in_reply_to",
				"email_references",
				"thread_id",
			]);

		if (folder) {
			const folderIdSubquery = this.#qb
				.select("folders")
				.fields(["id"])
				.where("name = ? OR id = ?", [folder, folder])
				.limit(1);
			query = query.where("folder_id = ?", folderIdSubquery);
		}

		const offset = (page - 1) * limit;
		query = query
			.orderBy(`${sortColumn} ${sortDirection}`)
			.limit(limit)
			.offset(offset);

		const result = query.execute();

		return (
			result.results?.map((email) => ({
				...email,
				read: !!email.read,
				starred: !!email.starred,
			})) ?? []
		);
	}

	async getEmail(id: string) {
		const email = this.#qb
			.select("emails")
			.fields(["*"])
			.where("id = ?", id)
			.one();

		if (!email.results) {
			return null;
		}

		const attachments = this.#qb
			.select("attachments")
			.fields(["*"])
			.where("email_id = ?", id)
			.execute();

		// Bodies over 96 KB live in R2 so the row stays well under SQLite's limit.
		let body = email.results.body ? String(email.results.body) : "";
		if (email.results.body_key) {
			const object = await this.env.BUCKET.get(String(email.results.body_key));
			if (object) body = await object.text();
		}

		const labels = this.#exec<{ label_id: string }>(
			"SELECT label_id FROM email_labels WHERE email_id = ?",
			id,
		).map((row) => String(row.label_id));

		return {
			...email.results,
			body,
			read: !!email.results.read,
			starred: !!email.results.starred,
			pinned: !!email.results.pinned,
			labels,
			attachments: attachments.results || [],
		};
	}

	async updateEmail(
		id: string,
		{ read, starred }: { read?: boolean; starred?: boolean },
	) {
		const data: { read?: number; starred?: number } = {};
		if (read !== undefined) {
			data.read = read ? 1 : 0;
		}
		if (starred !== undefined) {
			data.starred = starred ? 1 : 0;
		}

		if (Object.keys(data).length === 0) {
			return this.getEmail(id);
		}

		this.#qb
			.update({
				tableName: "emails",
				data,
				where: {
					conditions: "id = ?",
					params: [id],
				},
			})
			.execute();

		return this.getEmail(id);
	}

	async deleteEmail(id: string) {
		const attachments = this.#qb
			.select("attachments")
			.fields(["id", "filename"])
			.where("email_id = ?", id)
			.execute();

		this.#qb
			.delete({
				tableName: "emails",
				where: {
					conditions: "id = ?",
					params: [id],
				},
			})
			.execute();
		this.ctx.storage.sql.exec(
			"DELETE FROM email_labels WHERE email_id = ?",
			id,
		);
		this.#unindexEmail(id);

		return attachments.results || [];
	}

	async getAttachment(id: string) {
		const result = this.#qb
			.select<AttachmentData>("attachments")
			.fields(["*"])
			.where("id = ?", id)
			.one();
		return result.results;
	}

	async getFolders() {
		const query = this.#qb.select("folders").fields(["id", "name"]);

		const result = query.execute();
		return result.results || [];
	}

	async createFolder(id: string, name: string) {
		try {
			const result = this.#qb
				.insert({
					tableName: "folders",
					data: { id, name },
					returning: ["id", "name"],
				})
				.execute();
			const newFolder = result.results;
			return { ...newFolder, unreadCount: 0 };
		} catch (e: any) {
			if (e.message.includes("UNIQUE constraint failed")) {
				return null;
			}
			throw e;
		}
	}

	async updateFolder(id: string, name: string) {
		this.#qb
			.update({
				tableName: "folders",
				data: { name },
				where: {
					conditions: "id = ?",
					params: [id],
				},
			})
			.execute();
		const query = this.#qb
			.select("folders")
			.fields(["id", "name"])
			.where("id = ?", id);
		const result = query.one();
		return result.results;
	}

	async deleteFolder(id: string) {
		const folder = this.#qb
			.select<{ is_deletable: number }>("folders")
			.fields(["is_deletable"])
			.where("id = ?", id)
			.one();

		if (!folder.results || folder.results.is_deletable === 0) {
			return false;
		}

		this.#qb
			.delete({
				tableName: "folders",
				where: {
					conditions: "id = ?",
					params: [id],
				},
			})
			.execute();

		return true;
	}

	async getContacts() {
		const query = this.#qb.select("contacts").fields(["id", "name", "email"]);
		const result = query.execute();
		return result.results || [];
	}

	async createContact(contact: { name?: string; email: string }) {
		const result = this.#qb
			.insert({
				tableName: "contacts",
				data: contact,
				returning: ["id", "name", "email"],
			})
			.execute();
		return result.results;
	}

	async updateContact(id: number, contact: { name?: string; email?: string }) {
		this.#qb
			.update({
				tableName: "contacts",
				data: contact,
				where: {
					conditions: "id = ?",
					params: [id],
				},
			})
			.execute();
		const query = this.#qb
			.select("contacts")
			.fields(["id", "name", "email"])
			.where("id = ?", id);
		const result = query.one();
		return result.results;
	}

	async deleteContact(id: number) {
		this.#qb
			.delete({
				tableName: "contacts",
				where: {
					conditions: "id = ?",
					params: [id],
				},
			})
			.execute();
		return true;
	}

	async moveEmail(id: string, folderId: string) {
		const folder = this.#qb
			.select("folders")
			.fields(["id"])
			.where("id = ?", folderId)
			.one();

		if (!folder.results) {
			return false;
		}

		this.#qb
			.update({
				tableName: "emails",
				data: { folder_id: folderId },
				where: {
					conditions: "id = ?",
					params: [id],
				},
			})
			.execute();

		return true;
	}

	async searchEmails(options: {
		query: string;
		folder?: string;
		from?: string;
		to?: string;
		date_start?: string;
		date_end?: string;
	}) {
		const { query, folder, from, to, date_start, date_end } = options;
		let qb = this.#qb
			.select<EmailData>("emails")
			.fields([
				"id",
				"subject",
				"sender",
				"recipient",
				"date",
				"read",
				"starred",
				"in_reply_to",
				"email_references",
				"thread_id",
			]);

		if (folder) {
			const folderIdSubquery = this.#qb
				.select("folders")
				.fields(["id"])
				.where("name = ? OR id = ?", [folder, folder])
				.limit(1);
			qb = qb.where("folder_id = ?", folderIdSubquery);
		}

		if (from) {
			qb = qb.where("sender LIKE ?", `%${from}%`);
		}

		if (to) {
			qb = qb.where("recipient LIKE ?", `%${to}%`);
		}

		if (date_start) {
			qb = qb.where("date >= ?", date_start);
		}

		if (date_end) {
			qb = qb.where("date <= ?", date_end);
		}

		qb = qb.where("(subject LIKE ? OR body LIKE ?)", [
			`%${query}%`,
			`%${query}%`,
		]);

		const result = qb.execute();

		return (
			result.results?.map((email) => ({
				...email,
				read: !!email.read,
				starred: !!email.starred,
			})) ?? []
		);
	}

	async createEmail(
		folder: string,
		email: EmailData,
		attachments: AttachmentData[],
	) {
		const body = email.body ?? "";
		this.#qb
			.insert({
				tableName: "emails",
				data: {
					...email,
					folder_id: folder,
					message_id: email.id,
					preview: previewOf(body, body.includes("<")),
					has_attachments: attachments.length > 0 ? 1 : 0,
					size: body.length,
				},
			})
			.execute();

		if (attachments.length > 0) {
			this.#qb
				.insert({
					tableName: "attachments",
					data: attachments as any,
				})
				.execute();
		}

		this.#indexEmail({
			id: email.id,
			subject: email.subject,
			sender: email.sender,
			recipient: email.recipient,
			body: htmlToText(body),
		});
		this.#broadcast({ type: "changed", reason: "created" });
	}

	// ------------------------------------------------------------------
	// Mail engine
	//
	// Everything below runs inside the Durable Object, which gets 30 s of CPU
	// per request instead of the Worker's 10 ms. MIME parsing, full-text
	// indexing, rules, spam scoring and thread grouping all live here so the
	// Worker only has to hand over bytes and pass answers back.
	// ------------------------------------------------------------------

	#exec<T = Record<string, any>>(query: string, ...params: any[]): T[] {
		return this.ctx.storage.sql.exec(query, ...params).toArray() as T[];
	}

	/** Chunk ids so a query never exceeds SQLite's 100 bound parameters. */
	static #chunk<T>(items: T[], size = 80): T[][] {
		const out: T[][] = [];
		for (let i = 0; i < items.length; i += size)
			out.push(items.slice(i, i + size));
		return out;
	}

	#placeholders(count: number): string {
		return new Array(count).fill("?").join(", ");
	}

	// --- full-text index -------------------------------------------------

	#indexEmail(email: {
		id: string;
		subject?: string | null;
		sender?: string | null;
		recipient?: string | null;
		body?: string | null;
	}) {
		this.ctx.storage.sql.exec(
			"DELETE FROM emails_fts WHERE email_id = ?",
			email.id,
		);
		this.ctx.storage.sql.exec(
			"INSERT INTO emails_fts (email_id, subject, sender, recipient, body) VALUES (?, ?, ?, ?, ?)",
			email.id,
			email.subject ?? "",
			email.sender ?? "",
			email.recipient ?? "",
			email.body ?? "",
		);
	}

	#unindexEmail(id: string) {
		this.ctx.storage.sql.exec("DELETE FROM emails_fts WHERE email_id = ?", id);
	}

	// --- settings --------------------------------------------------------

	#getSetting(key: string): string | null {
		const row = this.#exec<{ value: string }>(
			"SELECT value FROM settings WHERE key = ?",
			key,
		)[0];
		return row ? String(row.value) : null;
	}

	#putSetting(key: string, value: string) {
		this.ctx.storage.sql.exec(
			"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			key,
			value,
		);
	}

	async getMailboxSettings(): Promise<Record<string, any>> {
		const raw = this.#getSetting("mailbox");
		return raw ? JSON.parse(raw) : {};
	}

	async putMailboxSettings(
		settings: Record<string, any>,
	): Promise<Record<string, any>> {
		const current = await this.getMailboxSettings();
		const merged = { ...current, ...settings };
		this.#putSetting("mailbox", JSON.stringify(merged));
		return merged;
	}

	// --- live updates (hibernatable WebSockets) ---------------------------

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
			const pair = new WebSocketPair();
			this.ctx.acceptWebSocket(pair[1]);
			return new Response(null, { status: 101, webSocket: pair[0] });
		}
		return new Response("Not found", { status: 404 });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		// Keep-alive only: clients read state over the JSON API, the socket just
		// tells them when to refetch. Hibernation means idle sockets cost nothing.
		if (typeof message === "string" && message === "ping") ws.send("pong");
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string) {
		try {
			ws.close(code === 1006 ? 1000 : code, reason);
		} catch {
			// already closed
		}
	}

	#broadcast(payload: Record<string, any>) {
		const message = JSON.stringify(payload);
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(message);
			} catch {
				// a dead socket will be cleaned up by the runtime
			}
		}
	}

	// --- alarms: snooze, scheduled send, follow-up reminders ---------------

	#nextWake(): number | null {
		const row = this.#exec<{ next: number | null }>(
			`SELECT MIN(t) AS next FROM (
                SELECT MIN(snoozed_until) AS t FROM emails WHERE snoozed_until IS NOT NULL
                UNION ALL SELECT MIN(scheduled_at) FROM emails WHERE scheduled_at IS NOT NULL
                UNION ALL SELECT MIN(remind_at) FROM emails WHERE remind_at IS NOT NULL
            )`,
		)[0];
		const next = row?.next;
		return next === null || next === undefined ? null : Number(next);
	}

	async #rescheduleAlarm() {
		const next = this.#nextWake();
		if (next === null) return;
		const current = await this.ctx.storage.getAlarm();
		if (current === null || next < current) {
			await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
		}
	}

	async alarm() {
		const now = Date.now();

		// Snoozed mail returns to the folder it came from.
		const woken = this.#exec<{ id: string }>(
			"SELECT id FROM emails WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?",
			now,
		);
		if (woken.length > 0) {
			this.ctx.storage.sql.exec(
				`UPDATE emails
                 SET folder_id = COALESCE(return_folder, 'inbox'),
                     snoozed_until = NULL,
                     return_folder = NULL,
                     read = 0
                 WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?`,
				now,
			);
		}

		// Scheduled mail goes out now.
		const due = this.#exec<Record<string, any>>(
			"SELECT * FROM emails WHERE scheduled_at IS NOT NULL AND scheduled_at <= ? LIMIT 10",
			now,
		);
		for (const row of due) {
			await this.#deliverScheduled(row);
		}

		// Follow-up reminders surface as an unread flag on the sent message.
		const reminders = this.#exec<{ id: string }>(
			"SELECT id FROM emails WHERE remind_at IS NOT NULL AND remind_at <= ?",
			now,
		);
		if (reminders.length > 0) {
			this.ctx.storage.sql.exec(
				"UPDATE emails SET remind_at = NULL, starred = 1, read = 0 WHERE remind_at IS NOT NULL AND remind_at <= ?",
				now,
			);
		}

		if (woken.length || due.length || reminders.length) {
			this.#broadcast({ type: "changed", reason: "alarm" });
		}

		const next = this.#nextWake();
		if (next !== null) {
			await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
		}
	}

	async #deliverScheduled(row: Record<string, any>) {
		const { sendOutboundEmail } = await import("../outbound");
		const recipients = String(row.recipient || "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		try {
			const sent = await sendOutboundEmail(this.env, {
				from: String(row.sender || ""),
				to: recipients,
				subject: String(row.subject || ""),
				html: String(row.body || ""),
				inReplyTo: row.in_reply_to ? String(row.in_reply_to) : undefined,
				references: row.email_references
					? JSON.parse(String(row.email_references))
					: undefined,
			});
			const deliveredId = sent.messageId ?? crypto.randomUUID();
			this.ctx.storage.sql.exec(
				`UPDATE emails
                 SET id = ?, message_id = ?, folder_id = 'sent', scheduled_at = NULL,
                     date = ?, delivery_state = 'accepted', delivery_detail = 'Accepted by the provider',
                     delivery_at = ?
                 WHERE id = ?`,
				deliveredId,
				deliveredId,
				new Date().toISOString(),
				new Date().toISOString(),
				String(row.id),
			);
			this.#unindexEmail(String(row.id));
			this.#indexEmail({
				id: deliveredId,
				subject: String(row.subject || ""),
				sender: String(row.sender || ""),
				recipient: String(row.recipient || ""),
				body: String(row.body || ""),
			});
		} catch (error: any) {
			this.ctx.storage.sql.exec(
				`UPDATE emails
                 SET scheduled_at = NULL, folder_id = 'drafts',
                     delivery_state = 'failed', delivery_detail = ?
                 WHERE id = ?`,
				`Scheduled send failed: ${error?.message ?? "unknown error"}`,
				String(row.id),
			);
		}
	}

	// --- labels ------------------------------------------------------------

	async getLabels(): Promise<any[]> {
		return this.#exec(
			"SELECT id, name, color, position FROM labels ORDER BY position ASC, name ASC",
		);
	}

	async createLabel(input: { id?: string; name: string; color?: string }) {
		const id = input.id?.trim() || crypto.randomUUID();
		const position = Number(
			this.#exec<{ next: number }>(
				"SELECT COALESCE(MAX(position), 0) + 1 AS next FROM labels",
			)[0]?.next ?? 1,
		);
		this.ctx.storage.sql.exec(
			"INSERT INTO labels (id, name, color, position) VALUES (?, ?, ?, ?)",
			id,
			input.name,
			input.color ?? "#2b74e8",
			position,
		);
		return { id, name: input.name, color: input.color ?? "#2b74e8", position };
	}

	async updateLabel(
		id: string,
		input: { name?: string; color?: string; position?: number },
	): Promise<any | null> {
		const sets: string[] = [];
		const params: any[] = [];
		if (input.name !== undefined) {
			sets.push("name = ?");
			params.push(input.name);
		}
		if (input.color !== undefined) {
			sets.push("color = ?");
			params.push(input.color);
		}
		if (input.position !== undefined) {
			sets.push("position = ?");
			params.push(input.position);
		}
		if (sets.length === 0) return null;
		params.push(id);
		this.ctx.storage.sql.exec(
			`UPDATE labels SET ${sets.join(", ")} WHERE id = ?`,
			...params,
		);
		return (
			this.#exec(
				"SELECT id, name, color, position FROM labels WHERE id = ?",
				id,
			)[0] ?? null
		);
	}

	async deleteLabel(id: string) {
		this.ctx.storage.sql.exec(
			"DELETE FROM email_labels WHERE label_id = ?",
			id,
		);
		this.ctx.storage.sql.exec("DELETE FROM labels WHERE id = ?", id);
		return true;
	}

	// --- rules, blocklist, templates, saved searches ------------------------

	async getRules(): Promise<Rule[]> {
		return this.#exec<Record<string, any>>(
			"SELECT * FROM rules ORDER BY position ASC",
		).map((row) => ({
			id: String(row.id),
			name: String(row.name),
			enabled: row.enabled === 1,
			position: Number(row.position),
			matchAll: row.match_all === 1,
			conditions: JSON.parse(String(row.conditions)),
			actions: JSON.parse(String(row.actions)),
		}));
	}

	async putRule(rule: Rule) {
		const id = rule.id || crypto.randomUUID();
		this.ctx.storage.sql.exec(
			`INSERT INTO rules (id, name, enabled, position, match_all, conditions, actions)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled,
                 position = excluded.position, match_all = excluded.match_all,
                 conditions = excluded.conditions, actions = excluded.actions`,
			id,
			rule.name,
			rule.enabled ? 1 : 0,
			rule.position ?? 0,
			rule.matchAll ? 1 : 0,
			JSON.stringify(rule.conditions ?? []),
			JSON.stringify(rule.actions ?? {}),
		);
		return { ...rule, id };
	}

	async deleteRule(id: string) {
		this.ctx.storage.sql.exec("DELETE FROM rules WHERE id = ?", id);
		return true;
	}

	async getBlockedSenders(): Promise<string[]> {
		return this.#exec<{ address: string }>(
			"SELECT address FROM blocked_senders ORDER BY address",
		).map((row) => String(row.address));
	}

	async blockSender(address: string) {
		this.ctx.storage.sql.exec(
			"INSERT OR IGNORE INTO blocked_senders (address, created_at) VALUES (?, ?)",
			address.toLowerCase(),
			Date.now(),
		);
		// Existing mail from a blocked sender moves to Spam.
		const moved = this.#exec<{ id: string }>(
			"SELECT id FROM emails WHERE lower(sender) = ? AND folder_id NOT IN ('sent', 'drafts')",
			address.toLowerCase(),
		);
		if (moved.length > 0) {
			this.ctx.storage.sql.exec(
				"UPDATE emails SET folder_id = 'spam', spam_reason = 'sender blocked' WHERE lower(sender) = ? AND folder_id NOT IN ('sent', 'drafts')",
				address.toLowerCase(),
			);
		}
		return { address: address.toLowerCase(), moved: moved.length };
	}

	async unblockSender(address: string) {
		this.ctx.storage.sql.exec(
			"DELETE FROM blocked_senders WHERE address = ?",
			address.toLowerCase(),
		);
		return true;
	}

	async getTemplates(): Promise<any[]> {
		return this.#exec(
			"SELECT id, name, subject, body FROM templates ORDER BY name",
		);
	}

	async putTemplate(template: {
		id?: string;
		name: string;
		subject?: string;
		body?: string;
	}) {
		const id = template.id || crypto.randomUUID();
		this.ctx.storage.sql.exec(
			`INSERT INTO templates (id, name, subject, body) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, subject = excluded.subject, body = excluded.body`,
			id,
			template.name,
			template.subject ?? "",
			template.body ?? "",
		);
		return { ...template, id };
	}

	async deleteTemplate(id: string) {
		this.ctx.storage.sql.exec("DELETE FROM templates WHERE id = ?", id);
		return true;
	}

	async getSavedSearches(): Promise<any[]> {
		return this.#exec(
			"SELECT id, name, query, position FROM saved_searches ORDER BY position ASC, name ASC",
		);
	}

	async putSavedSearch(search: {
		id?: string;
		name: string;
		query: string;
		position?: number;
	}) {
		const id = search.id || crypto.randomUUID();
		this.ctx.storage.sql.exec(
			`INSERT INTO saved_searches (id, name, query, position) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, query = excluded.query, position = excluded.position`,
			id,
			search.name,
			search.query,
			search.position ?? 0,
		);
		return { ...search, id };
	}

	async deleteSavedSearch(id: string) {
		this.ctx.storage.sql.exec("DELETE FROM saved_searches WHERE id = ?", id);
		return true;
	}

	// --- reading: threads and messages --------------------------------------

	#labelsFor(ids: string[]): Map<string, string[]> {
		const map = new Map<string, string[]>();
		for (const group of MailboxDO.#chunk(ids)) {
			const rows = this.#exec<{ email_id: string; label_id: string }>(
				`SELECT email_id, label_id FROM email_labels WHERE email_id IN (${this.#placeholders(group.length)})`,
				...group,
			);
			for (const row of rows) {
				const key = String(row.email_id);
				const list = map.get(key) ?? [];
				list.push(String(row.label_id));
				map.set(key, list);
			}
		}
		return map;
	}

	#buildFilters(options: ThreadQuery): { sql: string; params: any[] } {
		const clauses: string[] = [];
		const params: any[] = [];
		const query = options.query ? parseSearchQuery(options.query) : null;

		const folder = query?.folder ?? options.folder;
		if (folder && folder !== "all") {
			clauses.push("folder_id = ?");
			params.push(folder);
		} else if (!options.includeSpam) {
			clauses.push("folder_id NOT IN ('spam', 'trash')");
		}

		if (options.labelId) {
			clauses.push(
				"id IN (SELECT email_id FROM email_labels WHERE label_id = ?)",
			);
			params.push(options.labelId);
		}
		if (options.category) {
			clauses.push("category = ?");
			params.push(options.category);
		}
		if (options.unreadOnly) clauses.push("read = 0");
		if (options.flaggedOnly) clauses.push("starred = 1");

		if (query) {
			if (query.match) {
				clauses.push(
					"id IN (SELECT email_id FROM emails_fts WHERE emails_fts MATCH ?)",
				);
				params.push(query.match);
			}
			for (const from of query.from) {
				clauses.push("lower(sender) LIKE ?");
				params.push(`%${from}%`);
			}
			for (const to of query.to) {
				clauses.push(
					"(lower(recipient) LIKE ? OR lower(COALESCE(cc, '')) LIKE ?)",
				);
				params.push(`%${to}%`, `%${to}%`);
			}
			for (const subject of query.subject) {
				clauses.push("lower(COALESCE(subject, '')) LIKE ?");
				params.push(`%${subject.toLowerCase()}%`);
			}
			for (const label of query.labels) {
				clauses.push(
					"id IN (SELECT el.email_id FROM email_labels el JOIN labels l ON l.id = el.label_id WHERE lower(l.id) = ? OR lower(l.name) = ?)",
				);
				params.push(label, label);
			}
			if (query.category) {
				clauses.push("category = ?");
				params.push(query.category);
			}
			if (query.hasAttachment) clauses.push("has_attachments = 1");
			if (query.isUnread !== null)
				clauses.push(query.isUnread ? "read = 0" : "read = 1");
			if (query.isFlagged !== null)
				clauses.push(query.isFlagged ? "starred = 1" : "starred = 0");
			if (query.isPinned !== null)
				clauses.push(query.isPinned ? "pinned = 1" : "pinned = 0");
			if (query.before) {
				clauses.push("date <= ?");
				params.push(query.before);
			}
			if (query.after) {
				clauses.push("date >= ?");
				params.push(query.after);
			}
		}

		return {
			sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
			params,
		};
	}

	/**
	 * One page of conversations. Threads are grouped on `thread_id` (falling back
	 * to the message id), which `receiveEmail` fills from References/In-Reply-To.
	 * With conversations turned off every message is its own thread.
	 */
	async listThreads(options: ThreadQuery = {}): Promise<{
		threads: ThreadSummary[];
		page: number;
		limit: number;
		hasMore: boolean;
	}> {
		const limit = Math.min(Math.max(options.limit ?? 50, 1), 50);
		const page = Math.max(options.page ?? 1, 1);
		const offset = (page - 1) * limit;
		const group =
			options.conversations === false ? "id" : "COALESCE(thread_id, id)";
		const { sql: whereSql, params } = this.#buildFilters(options);

		const groups = this.#exec<Record<string, any>>(
			`SELECT ${group} AS gid,
                    MAX(date) AS last_date,
                    COUNT(*) AS message_count,
                    SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) AS unread_count,
                    MAX(starred) AS starred,
                    MAX(pinned) AS pinned,
                    MAX(has_attachments) AS has_attachments
             FROM emails ${whereSql}
             GROUP BY gid
             ORDER BY MAX(pinned) DESC, last_date DESC
             LIMIT ? OFFSET ?`,
			...params,
			limit + 1,
			offset,
		);

		const hasMore = groups.length > limit;
		const page_groups = groups.slice(0, limit);
		if (page_groups.length === 0) {
			return { threads: [], page, limit, hasMore: false };
		}

		const gids = page_groups.map((row) => String(row.gid));
		const rows: Record<string, any>[] = [];
		for (const chunk of MailboxDO.#chunk(gids)) {
			rows.push(
				...this.#exec<Record<string, any>>(
					`SELECT id, ${group} AS gid, folder_id, subject, sender, recipient, cc, date, read,
                            starred, pinned, preview, category, has_attachments, snoozed_until,
                            scheduled_at, delivery_state, delivery_detail, list_unsubscribe,
                            spam_reason, message_id, summary
                     FROM emails WHERE ${group} IN (${this.#placeholders(chunk.length)})
                     ORDER BY date DESC`,
					...chunk,
				),
			);
		}

		const byGroup = new Map<string, Record<string, any>[]>();
		for (const row of rows) {
			const key = String(row.gid);
			const list = byGroup.get(key) ?? [];
			list.push(row);
			byGroup.set(key, list);
		}

		const labelMap = this.#labelsFor(rows.map((row) => String(row.id)));

		const threads: ThreadSummary[] = page_groups.map((groupRow) => {
			const gid = String(groupRow.gid);
			const messages = byGroup.get(gid) ?? [];
			const latest = messages[0] ?? {};
			const labels = new Set<string>();
			const participants = new Set<string>();
			for (const message of messages) {
				for (const label of labelMap.get(String(message.id)) ?? [])
					labels.add(label);
				if (message.sender) participants.add(String(message.sender));
			}
			return {
				threadId: gid,
				id: String(latest.id ?? gid),
				folderId: String(latest.folder_id ?? ""),
				subject: String(latest.subject ?? ""),
				sender: String(latest.sender ?? ""),
				recipient: String(latest.recipient ?? ""),
				cc: latest.cc ? String(latest.cc) : null,
				date: String(latest.date ?? ""),
				preview: String(latest.preview ?? ""),
				unread: Number(groupRow.unread_count ?? 0) > 0,
				unreadCount: Number(groupRow.unread_count ?? 0),
				starred: Number(groupRow.starred ?? 0) === 1,
				pinned: Number(groupRow.pinned ?? 0) === 1,
				hasAttachments: Number(groupRow.has_attachments ?? 0) === 1,
				messageCount: Number(groupRow.message_count ?? messages.length),
				labels: [...labels],
				category: latest.category ? String(latest.category) : null,
				snoozedUntil: latest.snoozed_until
					? Number(latest.snoozed_until)
					: null,
				scheduledAt: latest.scheduled_at ? Number(latest.scheduled_at) : null,
				deliveryState: latest.delivery_state
					? String(latest.delivery_state)
					: null,
				deliveryDetail: latest.delivery_detail
					? String(latest.delivery_detail)
					: null,
				listUnsubscribe: latest.list_unsubscribe
					? String(latest.list_unsubscribe)
					: null,
				spamReason: latest.spam_reason ? String(latest.spam_reason) : null,
				summary: latest.summary ? String(latest.summary) : null,
				participants: [...participants],
			};
		});

		return { threads, page, limit, hasMore };
	}

	/** Every message in a conversation, bodies included. */
	async getThread(
		threadId: string,
	): Promise<{ threadId: string; subject: string; messages: any[] } | null> {
		const rows = this.#exec<Record<string, any>>(
			"SELECT * FROM emails WHERE COALESCE(thread_id, id) = ? OR id = ? ORDER BY date ASC",
			threadId,
			threadId,
		);
		if (rows.length === 0) return null;

		const ids = rows.map((row) => String(row.id));
		const labelMap = this.#labelsFor(ids);
		const attachments: Record<string, any>[] = [];
		for (const chunk of MailboxDO.#chunk(ids)) {
			attachments.push(
				...this.#exec<Record<string, any>>(
					`SELECT * FROM attachments WHERE email_id IN (${this.#placeholders(chunk.length)})`,
					...chunk,
				),
			);
		}

		const messages = [];
		for (const row of rows) {
			let body = row.body ? String(row.body) : "";
			if (row.body_key) {
				const object = await this.env.BUCKET.get(String(row.body_key));
				if (object) body = await object.text();
			}
			messages.push({
				...row,
				body,
				read: Number(row.read ?? 0) === 1,
				starred: Number(row.starred ?? 0) === 1,
				pinned: Number(row.pinned ?? 0) === 1,
				hasAttachments: Number(row.has_attachments ?? 0) === 1,
				labels: labelMap.get(String(row.id)) ?? [],
				attachments: attachments.filter(
					(a) => String(a.email_id) === String(row.id),
				),
			});
		}

		return {
			threadId,
			subject: String(rows[rows.length - 1].subject ?? ""),
			messages,
		};
	}

	// --- writing: flags, labels, folders, snooze ------------------------------

	#idsForThreads(threadIds: string[]): string[] {
		const ids: string[] = [];
		for (const chunk of MailboxDO.#chunk(threadIds)) {
			ids.push(
				...this.#exec<{ id: string }>(
					`SELECT id FROM emails WHERE COALESCE(thread_id, id) IN (${this.#placeholders(chunk.length)})`,
					...chunk,
				).map((row) => String(row.id)),
			);
		}
		return ids;
	}

	/**
	 * Bulk state change for messages or whole threads: read/flag/pin, move,
	 * label, snooze. One round trip so the list can update many rows at once.
	 */
	async mutate(input: MutateInput): Promise<{ changed: number }> {
		const ids = [
			...new Set([
				...(input.ids ?? []),
				...this.#idsForThreads(input.threadIds ?? []),
			]),
		];
		if (ids.length === 0) return { changed: 0 };

		const sets: string[] = [];
		const params: any[] = [];
		if (input.read !== undefined) {
			sets.push("read = ?");
			params.push(input.read ? 1 : 0);
		}
		if (input.starred !== undefined) {
			sets.push("starred = ?");
			params.push(input.starred ? 1 : 0);
		}
		if (input.pinned !== undefined) {
			sets.push("pinned = ?");
			params.push(input.pinned ? 1 : 0);
		}
		if (input.category !== undefined) {
			sets.push("category = ?");
			params.push(input.category);
		}
		if (input.folderId !== undefined) {
			sets.push(
				"folder_id = ?",
				"snoozed_until = NULL",
				"return_folder = NULL",
			);
			params.push(input.folderId);
			if (input.folderId !== "spam") sets.push("spam_reason = NULL");
		}
		if (input.snoozeUntil !== undefined) {
			if (input.snoozeUntil === null) {
				sets.push(
					"snoozed_until = NULL",
					"folder_id = COALESCE(return_folder, 'inbox')",
					"return_folder = NULL",
				);
			} else {
				sets.push(
					"return_folder = COALESCE(return_folder, folder_id)",
					"snoozed_until = ?",
					"folder_id = 'snoozed'",
				);
				params.push(input.snoozeUntil);
			}
		}
		if (input.remindAt !== undefined) {
			sets.push("remind_at = ?");
			params.push(input.remindAt);
		}

		if (sets.length > 0) {
			for (const chunk of MailboxDO.#chunk(ids, 60)) {
				this.ctx.storage.sql.exec(
					`UPDATE emails SET ${sets.join(", ")} WHERE id IN (${this.#placeholders(chunk.length)})`,
					...params,
					...chunk,
				);
			}
		}

		for (const labelId of input.addLabels ?? []) {
			for (const id of ids) {
				this.ctx.storage.sql.exec(
					"INSERT OR IGNORE INTO email_labels (email_id, label_id) VALUES (?, ?)",
					id,
					labelId,
				);
			}
		}
		for (const labelId of input.removeLabels ?? []) {
			for (const chunk of MailboxDO.#chunk(ids, 60)) {
				this.ctx.storage.sql.exec(
					`DELETE FROM email_labels WHERE label_id = ? AND email_id IN (${this.#placeholders(chunk.length)})`,
					labelId,
					...chunk,
				);
			}
		}

		if (input.snoozeUntil || input.remindAt) await this.#rescheduleAlarm();
		this.#broadcast({ type: "changed", reason: "mutate" });
		return { changed: ids.length };
	}

	/** Delete messages (or whole threads) and their attachment objects. */
	async deleteMessages(input: {
		ids?: string[];
		threadIds?: string[];
	}): Promise<{ deleted: number; attachments: any[] }> {
		const ids = [
			...new Set([
				...(input.ids ?? []),
				...this.#idsForThreads(input.threadIds ?? []),
			]),
		];
		if (ids.length === 0) return { deleted: 0, attachments: [] as any[] };

		const attachments: Record<string, any>[] = [];
		for (const chunk of MailboxDO.#chunk(ids)) {
			attachments.push(
				...this.#exec<Record<string, any>>(
					`SELECT id, email_id, filename FROM attachments WHERE email_id IN (${this.#placeholders(chunk.length)})`,
					...chunk,
				),
			);
			this.ctx.storage.sql.exec(
				`DELETE FROM emails WHERE id IN (${this.#placeholders(chunk.length)})`,
				...chunk,
			);
			this.ctx.storage.sql.exec(
				`DELETE FROM email_labels WHERE email_id IN (${this.#placeholders(chunk.length)})`,
				...chunk,
			);
		}
		for (const id of ids) this.#unindexEmail(id);
		this.#broadcast({ type: "changed", reason: "delete" });
		return { deleted: ids.length, attachments };
	}

	// --- counts and storage ---------------------------------------------------

	async getCounts() {
		const folders = this.#exec<Record<string, any>>(
			`SELECT f.id AS id, f.name AS name, f.is_deletable AS is_deletable,
                    COUNT(e.id) AS total,
                    SUM(CASE WHEN e.read = 0 THEN 1 ELSE 0 END) AS unread
             FROM folders f LEFT JOIN emails e ON e.folder_id = f.id
             GROUP BY f.id ORDER BY f.name`,
		).map((row) => ({
			id: String(row.id),
			name: String(row.name),
			isDeletable: Number(row.is_deletable ?? 1) === 1,
			total: Number(row.total ?? 0),
			unread: Number(row.unread ?? 0),
		}));

		const categories = this.#exec<Record<string, any>>(
			`SELECT category AS id, COUNT(*) AS total,
                    SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) AS unread
             FROM emails WHERE category IS NOT NULL AND folder_id = 'inbox' GROUP BY category`,
		).map((row) => ({
			id: String(row.id),
			total: Number(row.total ?? 0),
			unread: Number(row.unread ?? 0),
		}));

		const labels = this.#exec<Record<string, any>>(
			`SELECT l.id AS id, COUNT(el.email_id) AS total,
                    SUM(CASE WHEN e.read = 0 THEN 1 ELSE 0 END) AS unread
             FROM labels l
             LEFT JOIN email_labels el ON el.label_id = l.id
             LEFT JOIN emails e ON e.id = el.email_id
             GROUP BY l.id`,
		).map((row) => ({
			id: String(row.id),
			total: Number(row.total ?? 0),
			unread: Number(row.unread ?? 0),
		}));

		return { folders, categories, labels };
	}

	async getStats() {
		const totals = this.#exec<Record<string, any>>(
			"SELECT COUNT(*) AS messages, COALESCE(SUM(size), 0) AS bytes FROM emails",
		)[0];
		const attachments = this.#exec<Record<string, any>>(
			"SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM attachments",
		)[0];
		const oldest = this.#exec<{ date: string }>(
			"SELECT MIN(date) AS date FROM emails",
		)[0];
		return {
			messages: Number(totals?.messages ?? 0),
			messageBytes: Number(totals?.bytes ?? 0),
			attachmentCount: Number(attachments?.files ?? 0),
			attachmentBytes: Number(attachments?.bytes ?? 0),
			oldestMessage: oldest?.date ? String(oldest.date) : null,
			ai: await this.getAiBudget(),
		};
	}

	// --- inbound pipeline -----------------------------------------------------

	#uniqueMessageId(candidate: string | null): string {
		const base = candidate?.trim();
		if (!base) return crypto.randomUUID();
		const existing = this.#exec<{ id: string }>(
			"SELECT id FROM emails WHERE id = ? LIMIT 1",
			base,
		);
		return existing.length === 0
			? base
			: `${base}#${crypto.randomUUID().slice(0, 8)}`;
	}

	#upsertContact(address: string, name: string) {
		if (!address) return;
		this.ctx.storage.sql.exec(
			`INSERT INTO contacts (name, email, last_seen, message_count) VALUES (?, ?, ?, 1)
             ON CONFLICT(email) DO UPDATE SET
                name = CASE WHEN COALESCE(contacts.name, '') = '' THEN excluded.name ELSE contacts.name END,
                last_seen = excluded.last_seen,
                message_count = COALESCE(contacts.message_count, 0) + 1`,
			name,
			address.toLowerCase(),
			Date.now(),
		);
	}

	/**
	 * Parse and file one inbound message. The Worker hands over raw bytes and
	 * does no MIME work itself, so an 8 MB message with attachments cannot blow
	 * the Worker's 10 ms CPU limit.
	 */
	async ingestRaw(raw: ArrayBuffer, fallbackMailbox: string) {
		const parsed = await new PostalMime().parse(raw);
		const mailbox =
			parsed.to?.[0]?.address?.toLowerCase() || fallbackMailbox.toLowerCase();
		const headers = headerBag(parsed.headers as any);

		const sender = parsed.from?.address?.toLowerCase() ?? "";
		const senderName = displayName(parsed.from?.name, sender);
		const subject = parsed.subject ?? "";
		const isHtml = Boolean(parsed.html);
		const rawBody = parsed.html || parsed.text || "";
		const text = htmlToText(isHtml ? rawBody : rawBody.replace(/\n/g, "<br>"));
		const preview = previewOf(rawBody, isHtml);

		const messageId = this.#uniqueMessageId(
			parsed.messageId ? stripBrackets(parsed.messageId) : null,
		);

		const inReplyTo = parsed.inReplyTo ? stripBrackets(parsed.inReplyTo) : null;
		const references = parsed.references
			? parsed.references.split(/\s+/).filter(Boolean).map(stripBrackets)
			: [];
		const threadId = references[0] || inReplyTo || messageId;

		const auth = parseAuthResults(headers.get("authentication-results"));
		const blocked = new Set(await this.getBlockedSenders());
		const spam = spamVerdict({ auth, sender, blocked, subject });
		const category = categorise({ headers, sender, subject, text });
		const listUnsubscribe = unsubscribeTarget(headers.get("list-unsubscribe"));

		// Attachments go to R2; only their metadata stays in SQLite.
		const attachmentRows: Record<string, any>[] = [];
		for (const attachment of parsed.attachments ?? []) {
			const attachmentId = crypto.randomUUID();
			const filename = attachment.filename || "untitled";
			const key = `attachments/${safeKeySegment(messageId)}/${attachmentId}/${filename}`;
			await this.env.BUCKET.put(key, attachment.content as any);
			attachmentRows.push({
				id: attachmentId,
				email_id: messageId,
				filename,
				mimetype: attachment.mimeType,
				size:
					typeof attachment.content === "string"
						? attachment.content.length
						: (attachment.content as ArrayBuffer).byteLength,
				content_id: attachment.contentId || null,
				disposition: attachment.disposition ?? "attachment",
			});
		}

		// A large HTML body lives in R2; the searchable text stays in the index.
		let body = rawBody;
		let bodyKey: string | null = null;
		if (rawBody.length > 96_000) {
			bodyKey = `bodies/${mailbox}/${safeKeySegment(messageId)}.html`;
			await this.env.BUCKET.put(bodyKey, rawBody);
			body = preview;
		}

		const actions = applyRules(await this.getRules(), {
			from: sender,
			to: mailbox,
			subject,
			body: text,
			list: headers.get("list-id") ?? "",
		});

		let folder = spam.isSpam ? "spam" : "inbox";
		if (actions.folder) folder = actions.folder;

		this.ctx.storage.sql.exec(
			`INSERT INTO emails (
                id, folder_id, subject, sender, recipient, cc, date, read, starred, pinned, body,
                in_reply_to, email_references, thread_id, message_id, preview, category,
                has_attachments, list_unsubscribe, spam_reason, auth_results, body_key, size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			messageId,
			folder,
			subject,
			sender,
			mailbox,
			addressList(parsed.cc as any).join(", ") || null,
			new Date(parsed.date ?? Date.now()).toISOString(),
			actions.markRead ? 1 : 0,
			actions.star ? 1 : 0,
			actions.pin ? 1 : 0,
			body,
			inReplyTo,
			references.length > 0 ? JSON.stringify(references) : null,
			threadId,
			messageId,
			preview,
			actions.category ?? category,
			attachmentRows.length > 0 ? 1 : 0,
			listUnsubscribe,
			spam.reason && spam.isSpam ? spam.reason : null,
			JSON.stringify(auth),
			bodyKey,
			rawBody.length,
		);

		for (const row of attachmentRows) {
			this.ctx.storage.sql.exec(
				`INSERT INTO attachments (id, email_id, filename, mimetype, size, content_id, disposition)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				row.id,
				row.email_id,
				row.filename,
				row.mimetype,
				row.size,
				row.content_id,
				row.disposition,
			);
		}

		for (const labelId of actions.addLabels ?? []) {
			this.ctx.storage.sql.exec(
				"INSERT OR IGNORE INTO email_labels (email_id, label_id) VALUES (?, ?)",
				messageId,
				labelId,
			);
		}

		this.#indexEmail({
			id: messageId,
			subject,
			sender,
			recipient: mailbox,
			body: text,
		});
		if (!spam.isSpam) this.#upsertContact(sender, senderName);
		this.#broadcast({
			type: "message",
			folder,
			id: messageId,
			threadId,
			subject,
			sender,
			preview,
		});

		return { id: messageId, threadId, folder, category, spam: spam.isSpam };
	}

	// --- outbound bookkeeping --------------------------------------------------

	/** Record a message we sent, so it threads with the replies that come back. */
	async recordSent(input: {
		id: string;
		from: string;
		to: string[];
		cc?: string[];
		bcc?: string[];
		subject: string;
		html?: string;
		text?: string;
		inReplyTo?: string | null;
		references?: string[] | null;
		threadId?: string | null;
		attachments?: Record<string, any>[];
		remindAt?: number | null;
	}) {
		const body = input.html || input.text || "";
		const preview = previewOf(body, Boolean(input.html));
		this.ctx.storage.sql.exec(
			`INSERT INTO emails (
                id, folder_id, subject, sender, recipient, cc, bcc, date, read, body, preview,
                in_reply_to, email_references, thread_id, message_id, has_attachments, size,
                delivery_state, delivery_detail, delivery_at, remind_at
            ) VALUES (?, 'sent', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`,
			input.id,
			input.subject,
			input.from,
			input.to.join(", "),
			input.cc?.join(", ") || null,
			input.bcc?.join(", ") || null,
			new Date().toISOString(),
			body,
			preview,
			input.inReplyTo ?? null,
			input.references ? JSON.stringify(input.references) : null,
			input.threadId ?? input.inReplyTo ?? input.id,
			input.id,
			input.attachments?.length ? 1 : 0,
			body.length,
			"Handed to the provider",
			new Date().toISOString(),
			input.remindAt ?? null,
		);

		for (const row of input.attachments ?? []) {
			this.ctx.storage.sql.exec(
				`INSERT INTO attachments (id, email_id, filename, mimetype, size, content_id, disposition)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				row.id,
				input.id,
				row.filename,
				row.mimetype,
				row.size,
				row.content_id ?? null,
				row.disposition ?? "attachment",
			);
		}

		this.#indexEmail({
			id: input.id,
			subject: input.subject,
			sender: input.from,
			recipient: input.to.join(", "),
			body: htmlToText(body),
		});
		for (const address of [...input.to, ...(input.cc ?? [])]) {
			this.#upsertContact(address, displayName(undefined, address));
		}
		if (input.remindAt) await this.#rescheduleAlarm();
		this.#broadcast({ type: "changed", reason: "sent" });
		return { id: input.id };
	}

	/** SES delivery notifications (via SNS) land here. */
	async updateDelivery(messageId: string, state: string, detail: string) {
		this.ctx.storage.sql.exec(
			`UPDATE emails SET delivery_state = ?, delivery_detail = ?, delivery_at = ?
             WHERE id = ? OR message_id = ? OR id LIKE ?`,
			state,
			detail,
			new Date().toISOString(),
			messageId,
			messageId,
			`${messageId}@%`,
		);
		this.#broadcast({ type: "changed", reason: "delivery" });
		return true;
	}

	// --- drafts and scheduled send ---------------------------------------------

	async saveDraft(input: {
		id?: string;
		from: string;
		to?: string[];
		cc?: string[];
		bcc?: string[];
		subject?: string;
		html?: string;
		inReplyTo?: string | null;
		references?: string[] | null;
		threadId?: string | null;
		scheduledAt?: number | null;
	}) {
		const id = input.id || `draft-${crypto.randomUUID()}`;
		const body = input.html ?? "";
		const folder = input.scheduledAt ? "scheduled" : "drafts";
		this.ctx.storage.sql.exec(
			`INSERT INTO emails (
                id, folder_id, subject, sender, recipient, cc, bcc, date, read, body, preview,
                in_reply_to, email_references, thread_id, scheduled_at, size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                folder_id = excluded.folder_id, subject = excluded.subject,
                recipient = excluded.recipient, cc = excluded.cc, bcc = excluded.bcc,
                date = excluded.date, body = excluded.body, preview = excluded.preview,
                scheduled_at = excluded.scheduled_at, size = excluded.size`,
			id,
			folder,
			input.subject ?? "",
			input.from,
			(input.to ?? []).join(", "),
			input.cc?.join(", ") || null,
			input.bcc?.join(", ") || null,
			new Date().toISOString(),
			body,
			previewOf(body, true),
			input.inReplyTo ?? null,
			input.references ? JSON.stringify(input.references) : null,
			input.threadId ?? null,
			input.scheduledAt ?? null,
			body.length,
		);
		this.#indexEmail({
			id,
			subject: input.subject ?? "",
			sender: input.from,
			recipient: (input.to ?? []).join(", "),
			body: htmlToText(body),
		});
		if (input.scheduledAt) await this.#rescheduleAlarm();
		return { id, scheduledAt: input.scheduledAt ?? null };
	}

	async getDraft(id: string): Promise<any | null> {
		const row = this.#exec<Record<string, any>>(
			"SELECT * FROM emails WHERE id = ? AND folder_id IN ('drafts', 'scheduled')",
			id,
		)[0];
		return row ?? null;
	}

	async cancelScheduled(id: string) {
		this.ctx.storage.sql.exec(
			"UPDATE emails SET scheduled_at = NULL, folder_id = 'drafts' WHERE id = ?",
			id,
		);
		return true;
	}

	// --- export ------------------------------------------------------------------

	/** One page of complete messages, for the browser-side backup. */
	async exportBatch(offset = 0, limit = 50): Promise<any[]> {
		const rows = this.#exec<Record<string, any>>(
			"SELECT * FROM emails ORDER BY date ASC LIMIT ? OFFSET ?",
			Math.min(limit, 100),
			offset,
		);
		const out = [];
		for (const row of rows) {
			let body = row.body ? String(row.body) : "";
			if (row.body_key) {
				const object = await this.env.BUCKET.get(String(row.body_key));
				if (object) body = await object.text();
			}
			out.push({ ...row, body });
		}
		return out;
	}

	// --- Workers AI (free tier, degrades when the daily budget is gone) -----------

	async getAiBudget() {
		const day = new Date().toISOString().slice(0, 10);
		const used = Number(this.#getSetting(`ai:${day}`) ?? 0);
		return {
			date: day,
			used,
			limit: AI_DAILY_NEURONS,
			available: used < AI_DAILY_NEURONS,
		};
	}

	#spendAi(neurons: number) {
		const day = new Date().toISOString().slice(0, 10);
		const used = Number(this.#getSetting(`ai:${day}`) ?? 0);
		this.#putSetting(`ai:${day}`, String(used + neurons));
	}

	async #runAi(
		system: string,
		user: string,
		maxTokens: number,
	): Promise<string | null> {
		const ai = (this.env as any).AI;
		if (!ai) return null;
		const budget = await this.getAiBudget();
		if (!budget.available) return null;
		try {
			const response = await ai.run(AI_MODEL, {
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
				max_tokens: maxTokens,
			});
			// Rough neuron accounting: enough to stop before the free tier errors.
			this.#spendAi(AI_NEURONS_PER_CALL);
			const text =
				typeof response === "string" ? response : (response?.response ?? "");
			return String(text).trim() || null;
		} catch {
			return null;
		}
	}

	/** Three bullets plus three short replies for a conversation. */
	async summarizeThread(threadId: string) {
		const thread = await this.getThread(threadId);
		if (!thread) return { available: false, reason: "not found" as const };

		const transcript = thread.messages
			.slice(-6)
			.map((message: any) => {
				const body = htmlToText(String(message.body ?? "")).slice(0, 1500);
				return `From: ${message.sender}\nDate: ${message.date}\n${body}`;
			})
			.join("\n\n---\n\n")
			.slice(0, 6000);

		const summary = await this.#runAi(
			"You summarise email threads for a busy person. Reply with at most three short bullet points, each on its own line starting with '- '. State decisions, dates and what is waiting on the reader. No preamble.",
			`Subject: ${thread.subject}\n\n${transcript}`,
			220,
		);
		if (!summary) {
			return { available: false, reason: "budget" as const };
		}

		const bullets = summary
			.split("\n")
			.map((line) => line.replace(/^[-*•]\s*/, "").trim())
			.filter(Boolean)
			.slice(0, 3);

		const latest = thread.messages[thread.messages.length - 1];
		this.ctx.storage.sql.exec(
			"UPDATE emails SET summary = ? WHERE id = ?",
			bullets.join("\n"),
			String(latest.id),
		);

		const repliesRaw = await this.#runAi(
			"Suggest three very short reply options (max 6 words each) to the last message. One per line, no numbering, no quotes.",
			`Subject: ${thread.subject}\n\n${transcript}`,
			60,
		);
		const quickReplies = (repliesRaw ?? "")
			.split("\n")
			.map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
			.filter(Boolean)
			.slice(0, 3);

		return {
			available: true as const,
			bullets,
			quickReplies,
			budget: await this.getAiBudget(),
		};
	}

	/** Rewrite a draft in the composer. */
	async rewriteDraft(text: string, tone: string) {
		const rewritten = await this.#runAi(
			`Rewrite the user's email so it is ${tone}. Keep the meaning and any facts, dates and names. Reply with the rewritten email only, no preamble, no subject line.`,
			text.slice(0, 4000),
			400,
		);
		if (!rewritten)
			return { available: false as const, budget: await this.getAiBudget() };
		return {
			available: true as const,
			text: rewritten,
			budget: await this.getAiBudget(),
		};
	}
}
