/**
 * The mailbox the UI reads from: the current scope (folder, label, category or
 * search), the page of threads in it, the open conversation, and the counts,
 * labels and saved searches around them.
 *
 * Lists and opened threads are cached in localStorage so mail stays readable
 * with no network.
 */

import { defineStore } from "pinia";
import { CACHE_PREFIX, clearCachedMail } from "@/services/cache";
import { type MutateInput, mailApi } from "@/services/mail";
import type {
	Counts,
	Identity,
	Label,
	MailStats,
	Thread,
	ThreadDetail,
} from "@/types/mail";

export interface Scope {
	folder: string;
	labelId: string | null;
	category: string | null;
	query: string;
}

const CACHE_LIMIT = 40;

function cacheGet<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(CACHE_PREFIX + key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

function cacheSet(key: string, value: unknown) {
	try {
		localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
	} catch {
		// storage full or blocked: caching is a nicety, not a requirement
	}
}

export const useMailStore = defineStore("mail", {
	state: () => ({
		identity: null as Identity | null,
		mailboxes: [] as Array<{ id: string; email: string; name: string }>,
		mailboxId: "",
		scope: {
			folder: "inbox",
			labelId: null,
			category: null,
			query: "",
		} as Scope,
		threads: [] as Thread[],
		page: 1,
		hasMore: false,
		loading: false,
		loadingMore: false,
		offline: false,
		error: "" as string,
		openThreadId: "" as string,
		thread: null as ThreadDetail | null,
		threadLoading: false,
		counts: null as Counts | null,
		labels: [] as Label[],
		savedSearches: [] as Array<{
			id: string;
			name: string;
			query: string;
			position: number;
		}>,
		stats: null as MailStats | null,
		selection: [] as string[],
		summary: null as { bullets: string[]; quickReplies: string[] } | null,
		summaryPending: false,
		conversations: true,
		socket: null as WebSocket | null,
		socketRetry: 0,
		/** Bumped whenever the scope or mailbox changes, so slow replies can be dropped. */
		requestToken: 0,
		pendingMutations: [] as Array<{ mailboxId: string; input: MutateInput }>,
	}),

	getters: {
		folderCounts: (state) => state.counts?.folders ?? [],
		unreadInbox: (state) =>
			state.counts?.folders.find((folder) => folder.id === "inbox")?.unread ??
			0,
		labelById: (state) => (id: string) =>
			state.labels.find((label) => label.id === id),
		scopeTitle: (state) => {
			if (state.scope.query) return `Search: ${state.scope.query}`;
			if (state.scope.labelId) {
				return (
					state.labels.find((l) => l.id === state.scope.labelId)?.name ??
					"Label"
				);
			}
			if (state.scope.category) {
				return (
					state.scope.category.charAt(0).toUpperCase() +
					state.scope.category.slice(1)
				);
			}
			const folder = state.counts?.folders.find(
				(f) => f.id === state.scope.folder,
			);
			return folder?.name ?? state.scope.folder;
		},
	},

	actions: {
		async bootstrap(mailboxId: string) {
			// Nothing from the previous mailbox may survive into this one — including
			// anything the service worker cached for a different signed-in account.
			if (this.mailboxId && this.mailboxId !== mailboxId) clearCachedMail();
			this.mailboxId = mailboxId;
			this.openThreadId = "";
			this.thread = null;
			this.summary = null;
			this.selection = [];
			this.page = 1;
			this.hasMore = false;
			this.threads = cacheGet<Thread[]>(`${mailboxId}:inbox`) ?? [];
			await Promise.all([
				this.loadCounts(),
				this.loadLabels(),
				this.loadSavedSearches(),
				this.loadThreads(),
			]);
			this.connectLive();
		},

		async loadIdentity() {
			try {
				const identity = await mailApi.identity();
				// A different person signing in on this browser must not read the
				// last one's cached mail, even into the same mailbox.
				const previous = localStorage.getItem("mail:identity");
				const current = identity.email ?? "";
				if (previous !== null && previous !== current) clearCachedMail();
				try {
					localStorage.setItem("mail:identity", current);
				} catch {
					// storage blocked: the cache is per-session anyway
				}
				this.identity = identity;
			} catch {
				this.identity = null;
			}
		},

		async loadMailboxes() {
			try {
				this.mailboxes = await mailApi.mailboxes();
			} catch {
				this.mailboxes = cacheGet<typeof this.mailboxes>("mailboxes") ?? [];
				return;
			}
			cacheSet("mailboxes", this.mailboxes);
		},

		cacheKey() {
			const { folder, labelId, category, query } = this.scope;
			return `${this.mailboxId}:${query ? `q:${query}` : labelId ? `l:${labelId}` : category ? `c:${category}` : folder}`;
		},

		async loadThreads(options: { append?: boolean } = {}) {
			if (!this.mailboxId) return;
			const append = options.append === true;
			if (append) this.loadingMore = true;
			else this.loading = true;
			this.error = "";
			const token = ++this.requestToken;
			const cacheKey = this.cacheKey();

			try {
				const result = await mailApi.threads(this.mailboxId, {
					folder: this.scope.query ? undefined : this.scope.folder,
					label: this.scope.labelId ?? undefined,
					category: this.scope.category ?? undefined,
					q: this.scope.query || undefined,
					page: append ? this.page + 1 : 1,
					limit: 50,
					conversations: this.conversations,
				});
				this.threads = append
					? [...this.threads, ...result.threads]
					: result.threads;
				this.page = result.page;
				this.hasMore = result.hasMore;
				this.offline = false;
				if (!append)
					cacheSet(this.cacheKey(), result.threads.slice(0, CACHE_LIMIT));
			} catch (error) {
				if (token !== this.requestToken) return;
				const cached = cacheGet<Thread[]>(cacheKey);
				if (cached) {
					this.threads = cached;
					this.offline = true;
				} else {
					this.error = (error as Error).message;
				}
			} finally {
				if (token === this.requestToken) {
					this.loading = false;
					this.loadingMore = false;
				}
			}
		},

		async loadMore() {
			if (this.hasMore && !this.loadingMore)
				await this.loadThreads({ append: true });
		},

		async loadCounts() {
			try {
				this.counts = await mailApi.counts(this.mailboxId);
				cacheSet(`${this.mailboxId}:counts`, this.counts);
			} catch {
				this.counts =
					cacheGet<Counts>(`${this.mailboxId}:counts`) ?? this.counts;
			}
		},

		async loadLabels() {
			try {
				this.labels = await mailApi.labels(this.mailboxId);
				cacheSet(`${this.mailboxId}:labels`, this.labels);
			} catch {
				this.labels =
					cacheGet<Label[]>(`${this.mailboxId}:labels`) ?? this.labels;
			}
		},

		async loadSavedSearches() {
			try {
				this.savedSearches = await mailApi.savedSearches(this.mailboxId);
			} catch {
				// a saved-search list that will not load is not worth an error banner
			}
		},

		async loadStats() {
			try {
				this.stats = await mailApi.stats(this.mailboxId);
			} catch {
				// shown as "unavailable" in settings
			}
		},

		setScope(scope: Partial<Scope>) {
			// A label or a category spans the whole mailbox: staying inside the
			// current folder would show only the mail that is in both.
			if (scope.labelId || scope.category) scope = { folder: "all", ...scope };
			this.scope = { ...this.scope, ...scope };
			this.openThreadId = "";
			this.thread = null;
			this.selection = [];
			void this.loadThreads();
		},

		async openThread(threadId: string) {
			this.openThreadId = threadId;
			this.summary = null;
			this.threadLoading = true;
			const mailboxId = this.mailboxId;
			const cached = cacheGet<ThreadDetail>(`${mailboxId}:t:${threadId}`);
			if (cached) this.thread = cached;
			try {
				const detail = await mailApi.thread(mailboxId, threadId);
				cacheSet(`${mailboxId}:t:${threadId}`, detail);
				// Another conversation was opened while this one loaded.
				if (this.openThreadId !== threadId || this.mailboxId !== mailboxId)
					return;
				this.thread = detail;
				this.offline = false;
			} catch (error) {
				if (this.openThreadId !== threadId) return;
				if (!cached) this.error = (error as Error).message;
				else this.offline = true;
			} finally {
				if (this.openThreadId === threadId) this.threadLoading = false;
			}

			const thread = this.threads.find((t) => t.threadId === threadId);
			if (thread?.unread) {
				thread.unread = false;
				thread.unreadCount = 0;
				await this.mutate(
					{ threadIds: [threadId], read: true },
					{ silent: true },
				);
				// The row updated instantly; the folder badges need the server's count.
				await this.loadCounts();
			}
		},

		closeThread() {
			this.openThreadId = "";
			this.thread = null;
			this.summary = null;
		},

		/** Apply a change locally first, then persist it. */
		async mutate(input: MutateInput, options: { silent?: boolean } = {}) {
			const ids = new Set(input.threadIds ?? []);
			for (const thread of this.threads) {
				if (!ids.has(thread.threadId)) continue;
				if (input.read !== undefined) {
					thread.unread = !input.read;
					thread.unreadCount = input.read ? 0 : Math.max(thread.unreadCount, 1);
				}
				if (input.starred !== undefined) thread.starred = input.starred;
				if (input.pinned !== undefined) thread.pinned = input.pinned;
				for (const label of input.addLabels ?? []) {
					if (!thread.labels.includes(label)) thread.labels.push(label);
				}
				for (const label of input.removeLabels ?? []) {
					thread.labels = thread.labels.filter((id) => id !== label);
				}
			}

			const leavesScope =
				input.folderId !== undefined || input.snoozeUntil !== undefined;
			if (leavesScope && !this.scope.query) {
				this.threads = this.threads.filter((t) => !ids.has(t.threadId));
				if (ids.has(this.openThreadId)) this.closeThread();
			}

			try {
				await mailApi.mutate(this.mailboxId, input);
				if (!options.silent) await this.loadCounts();
			} catch (error) {
				// Offline: keep the change and replay it when the network returns,
				// rather than throwing away what the list already shows.
				if (!navigator.onLine) {
					this.pendingMutations.push({ mailboxId: this.mailboxId, input });
					this.offline = true;
					return;
				}
				this.error = (error as Error).message;
				await this.loadThreads();
			}
		},

		/** Replay anything that could not be saved while offline. */
		async drainMutations() {
			if (this.pendingMutations.length === 0) return;
			const queued = [...this.pendingMutations];
			this.pendingMutations = [];
			for (const entry of queued) {
				try {
					await mailApi.mutate(entry.mailboxId, entry.input);
				} catch {
					this.pendingMutations.push(entry);
				}
			}
			if (this.pendingMutations.length === 0) {
				this.offline = false;
				await this.loadCounts();
				await this.loadThreads();
			}
		},

		async remove(threadIds: string[]) {
			const ids = new Set(threadIds);
			this.threads = this.threads.filter((t) => !ids.has(t.threadId));
			if (ids.has(this.openThreadId)) this.closeThread();
			try {
				await mailApi.remove(this.mailboxId, { threadIds });
				await this.loadCounts();
			} catch (error) {
				this.error = (error as Error).message;
			}
		},

		async summarizeOpenThread() {
			if (!this.openThreadId) return;
			this.summaryPending = true;
			try {
				const result = await mailApi.summarize(
					this.mailboxId,
					this.openThreadId,
				);
				this.summary = result.available
					? {
							bullets: result.bullets ?? [],
							quickReplies: result.quickReplies ?? [],
						}
					: null;
				if (!result.available) {
					this.error =
						result.reason === "budget"
							? "Today's Workers AI budget is used up — summaries come back tomorrow."
							: "Summaries are unavailable.";
				}
			} catch (error) {
				this.error = (error as Error).message;
			} finally {
				this.summaryPending = false;
			}
		},

		toggleSelection(threadId: string) {
			this.selection = this.selection.includes(threadId)
				? this.selection.filter((id) => id !== threadId)
				: [...this.selection, threadId];
		},

		clearSelection() {
			this.selection = [];
		},

		/**
		 * Live updates over a hibernatable WebSocket: the socket only says
		 * "something changed", the client refetches what it is showing.
		 */
		connectLive() {
			if (!this.mailboxId || this.socket) return;
			try {
				const socket = new WebSocket(mailApi.liveUrl(this.mailboxId));
				this.socket = socket;
				socket.addEventListener("message", () => {
					void this.loadCounts();
					void this.loadThreads();
				});
				socket.addEventListener("open", () => {
					this.socketRetry = 0;
					this.offline = false;
				});
				socket.addEventListener("close", () => {
					this.socket = null;
					const delay = Math.min(30_000, 2 ** this.socketRetry * 1000);
					this.socketRetry += 1;
					setTimeout(() => this.connectLive(), delay);
				});
			} catch {
				this.socket = null;
			}
		},

		disconnectLive() {
			this.socket?.close();
			this.socket = null;
		},
	},
});
