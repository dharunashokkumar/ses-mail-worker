/**
 * Composing: floating windows, inline replies, auto-saved drafts, undo send,
 * scheduled send and an outbox that holds mail written offline.
 */

import { defineStore } from "pinia";
import { mailApi } from "@/services/mail";
import { usePrefsStore } from "@/stores/prefs";
import type { Draft, Message, OutgoingAttachment, Thread } from "@/types/mail";

export interface ComposerWindow extends Draft {
	uid: string;
	minimised: boolean;
	saving: boolean;
	scheduledAt: number | null;
}

export interface PendingSend {
	uid: string;
	draft: ComposerWindow;
	/** The mailbox this was written in: it may not be the open one by the time it sends. */
	mailboxId: string;
	sendAt: number;
	timer: number;
}

const OUTBOX_KEY = "mail:outbox";

function uid(): string {
	return Math.random().toString(36).slice(2, 10);
}

function blank(from: string): ComposerWindow {
	return {
		uid: uid(),
		id: "",
		from,
		to: [],
		cc: [],
		bcc: [],
		subject: "",
		html: "",
		attachments: [],
		inReplyTo: null,
		references: null,
		threadId: null,
		remindAt: null,
		inline: false,
		showCc: false,
		savedAt: null,
		minimised: false,
		saving: false,
		scheduledAt: null,
	};
}

function quote(message: Message): string {
	const when = new Date(message.date).toLocaleString();
	return `<p><br></p><blockquote style="margin:0 0 0 12px;padding-left:12px;border-left:2px solid currentColor;opacity:.75"><p>On ${when}, ${message.sender} wrote:</p>${message.body}</blockquote>`;
}

function loadOutbox(): Array<Record<string, any>> {
	try {
		return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]");
	} catch {
		return [];
	}
}

function saveOutbox(items: Array<Record<string, any>>) {
	try {
		localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
	} catch {
		// nothing to do: the send simply cannot be queued
	}
}

export const useComposeStore = defineStore("compose", {
	state: () => ({
		windows: [] as ComposerWindow[],
		pending: [] as PendingSend[],
		outbox: loadOutbox(),
		mailboxId: "",
		lastError: "" as string,
	}),

	getters: {
		hasOpenWindow: (state) => state.windows.some((window) => !window.inline),
		inlineFor: (state) => (threadId: string) =>
			state.windows.find(
				(window) => window.inline && window.threadId === threadId,
			),
	},

	actions: {
		signature(): string {
			const prefs = usePrefsStore().prefs;
			if (!prefs.signatureEnabled || !prefs.signature.trim()) return "";
			return `<p><br></p><p>${prefs.signature.replace(/\n/g, "<br>")}</p>`;
		},

		openNew(to: string[] = []) {
			const window = blank(this.mailboxId);
			window.to = to;
			window.html = this.signature();
			this.windows.push(window);
			return window;
		},

		openReply(
			thread: Thread | null,
			message: Message,
			options: { all?: boolean; inline?: boolean } = {},
		) {
			const existing = options.inline
				? this.windows.find(
						(w) => w.inline && w.threadId === (message.thread_id ?? message.id),
					)
				: undefined;
			if (existing) return existing;

			const window = blank(this.mailboxId);
			window.inline = options.inline === true;
			// Replying to a message you sent goes back to the same recipients.
			const own = message.sender === this.mailboxId;
			window.to = own
				? message.recipient
						.split(",")
						.map((address) => address.trim())
						.filter(Boolean)
				: [message.sender];
			if (options.all) {
				const others = [
					own ? "" : message.recipient,
					...(message.cc ?? "").split(","),
				]
					.map((address) => address.trim().toLowerCase())
					.filter((address) => address && address !== this.mailboxId);
				window.cc = [...new Set(others)];
				window.showCc = window.cc.length > 0;
			}
			window.subject = message.subject.replace(/^(re:\s*)+/i, "");
			window.subject = `Re: ${window.subject}`;
			window.inReplyTo = message.message_id ?? message.id;
			const references = message.email_references
				? (JSON.parse(message.email_references) as string[])
				: [];
			window.references = [...references, message.message_id ?? message.id];
			window.threadId = message.thread_id ?? thread?.threadId ?? message.id;
			window.html = `${this.signature()}${quote(message)}`;
			this.windows.push(window);
			return window;
		},

		openForward(message: Message) {
			const window = blank(this.mailboxId);
			window.subject = `Fwd: ${message.subject.replace(/^(fwd:\s*)+/i, "")}`;
			window.html = `${this.signature()}<p>— Forwarded message —</p>${message.body}`;
			this.windows.push(window);
			return window;
		},

		close(uid: string) {
			this.windows = this.windows.filter((window) => window.uid !== uid);
		},

		update(uid: string, patch: Partial<ComposerWindow>) {
			const window = this.windows.find((item) => item.uid === uid);
			if (window) Object.assign(window, patch);
		},

		async attach(uid: string, files: File[]) {
			const window = this.windows.find((item) => item.uid === uid);
			if (!window) return;
			for (const file of files) {
				const content = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onerror = () => reject(reader.error);
					reader.onload = () => {
						const result = String(reader.result ?? "");
						resolve(result.slice(result.indexOf(",") + 1));
					};
					reader.readAsDataURL(file);
				});
				const attachment: OutgoingAttachment = {
					filename: file.name,
					type: file.type || "application/octet-stream",
					content,
					disposition: "attachment",
					size: file.size,
				};
				window.attachments.push(attachment);
			}
		},

		removeAttachment(uid: string, filename: string) {
			const window = this.windows.find((item) => item.uid === uid);
			if (window) {
				window.attachments = window.attachments.filter(
					(a) => a.filename !== filename,
				);
			}
		},

		async saveDraft(uid: string) {
			const window = this.windows.find((item) => item.uid === uid);
			if (!window || window.inline) return;
			if (!window.subject && !window.html && window.to.length === 0) return;
			window.saving = true;
			try {
				const result = await mailApi.saveDraft(this.mailboxId, {
					id: window.id || undefined,
					from: window.from,
					to: window.to,
					cc: window.cc,
					bcc: window.bcc,
					subject: window.subject,
					html: window.html,
					attachments: window.attachments.map(({ size, ...rest }) => rest),
					inReplyTo: window.inReplyTo,
					references: window.references,
					threadId: window.threadId,
				});
				window.id = result.id;
				window.savedAt = Date.now();
			} catch {
				// drafts are kept in the window until the network comes back
			} finally {
				window.saving = false;
			}
		},

		/**
		 * Sending waits out the undo window before it actually leaves. Nothing
		 * is sent early, so "Undo" really is an undo rather than a recall.
		 */
		queueSend(uid: string): PendingSend | null {
			const window = this.windows.find((item) => item.uid === uid);
			if (!window) return null;
			const seconds = usePrefsStore().prefs.undoSeconds;
			this.windows = this.windows.filter((item) => item.uid !== uid);

			const pending: PendingSend = {
				uid: window.uid,
				draft: window,
				mailboxId: this.mailboxId,
				sendAt: Date.now() + seconds * 1000,
				timer: 0,
			};
			pending.timer = setTimeout(() => {
				void this.flush(window.uid);
			}, seconds * 1000) as unknown as number;
			this.pending.push(pending);
			return pending;
		},

		undo(uid: string) {
			const index = this.pending.findIndex((item) => item.uid === uid);
			if (index === -1) return;
			const [pending] = this.pending.splice(index, 1);
			clearTimeout(pending.timer);
			this.windows.push(pending.draft);
		},

		/** Actually send: called when the undo window closes. */
		async flush(uid: string) {
			const index = this.pending.findIndex((item) => item.uid === uid);
			if (index === -1) return;
			const [pending] = this.pending.splice(index, 1);
			const draft = pending.draft;
			// Switching mailboxes during the undo window must not redirect the send.
			const mailboxId = pending.mailboxId;

			const payload: Record<string, any> = {
				from: draft.from,
				to: draft.to,
				cc: draft.cc,
				bcc: draft.bcc,
				subject: draft.subject,
				html: draft.html,
				attachments: draft.attachments.map(({ size, ...rest }) => rest),
				inReplyTo: draft.inReplyTo,
				references: draft.references,
				threadId: draft.threadId,
				draftId: draft.id || undefined,
				remindAt: draft.remindAt,
			};

			try {
				await mailApi.send(mailboxId, payload);
			} catch (error) {
				// Offline or a provider hiccup: hold it in the outbox and retry.
				this.outbox.push({ mailboxId, payload });
				saveOutbox(this.outbox);
				this.lastError = (error as Error).message;
			}
		},

		/** Schedule a send. The window stays open until the server has it. */
		async schedule(uid: string, at: number) {
			const window = this.windows.find((item) => item.uid === uid);
			if (!window) return;
			await mailApi.send(this.mailboxId, {
				from: window.from,
				to: window.to,
				cc: window.cc,
				bcc: window.bcc,
				subject: window.subject,
				html: window.html,
				attachments: window.attachments.map(({ size, ...rest }) => rest),
				inReplyTo: window.inReplyTo,
				references: window.references,
				threadId: window.threadId,
				draftId: window.id || undefined,
				scheduledAt: at,
			});
			this.windows = this.windows.filter((item) => item.uid !== uid);
		},

		/** Retry anything written while offline. */
		async drainOutbox() {
			if (this.outbox.length === 0 || !navigator.onLine) return;
			const remaining: Array<Record<string, any>> = [];
			for (const item of this.outbox) {
				try {
					await mailApi.send(item.mailboxId, item.payload);
				} catch {
					remaining.push(item);
				}
			}
			this.outbox = remaining;
			saveOutbox(remaining);
		},
	},
});
