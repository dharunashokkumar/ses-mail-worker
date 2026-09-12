/**
 * Client for the mail API. Every call is a thin wrapper: the Worker and the
 * Durable Object do the work, the dashboard just renders what comes back.
 */

import type {
	Counts,
	Identity,
	Label,
	MailStats,
	Message,
	Thread,
	ThreadDetail,
} from "@/types/mail";

export interface ThreadPage {
	threads: Thread[];
	page: number;
	limit: number;
	hasMore: boolean;
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

function authHeaders(): Record<string, string> {
	const session = localStorage.getItem("session");
	if (!session) return {};
	try {
		return { Authorization: `Bearer ${JSON.parse(session).id}` };
	} catch {
		return {};
	}
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(path, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...authHeaders(),
			...(options.headers ?? {}),
		},
	});
	if (response.status === 401) {
		// Behind Cloudflare Access a 401 means the Access session expired: a
		// reload sends the browser back through Access rather than to a login
		// form this deployment may not even have.
		localStorage.removeItem("session");
		if (!window.location.pathname.startsWith("/login")) {
			window.location.reload();
		}
		throw new Error("Unauthorized");
	}
	if (!response.ok) {
		const detail = await response.json().catch(() => null);
		throw new Error(detail?.error ?? `Request failed (${response.status})`);
	}
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

const base = (mailboxId: string) =>
	`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}`;

export const mailApi = {
	identity: () => request<Identity>("/api/v1/identity"),

	mailboxes: () =>
		request<Array<{ id: string; email: string; name: string }>>(
			"/api/v1/mailboxes",
		),

	threads: (
		mailboxId: string,
		params: Record<string, string | number | boolean | undefined>,
	) => {
		const search = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== "" && value !== null) {
				search.set(key, String(value));
			}
		}
		return request<ThreadPage>(
			`${base(mailboxId)}/threads?${search.toString()}`,
		);
	},

	thread: (mailboxId: string, threadId: string) =>
		request<ThreadDetail>(
			`${base(mailboxId)}/threads/${encodeURIComponent(threadId)}`,
		),

	mutate: (mailboxId: string, input: MutateInput) =>
		request<{ changed: number }>(`${base(mailboxId)}/threads/mutate`, {
			method: "POST",
			body: JSON.stringify(input),
		}),

	remove: (
		mailboxId: string,
		input: { ids?: string[]; threadIds?: string[] },
	) =>
		request<{ deleted: number }>(`${base(mailboxId)}/threads/delete`, {
			method: "POST",
			body: JSON.stringify(input),
		}),

	counts: (mailboxId: string) => request<Counts>(`${base(mailboxId)}/counts`),

	stats: (mailboxId: string) => request<MailStats>(`${base(mailboxId)}/stats`),

	labels: (mailboxId: string) => request<Label[]>(`${base(mailboxId)}/labels`),

	createLabel: (
		mailboxId: string,
		input: { id?: string; name: string; color?: string },
	) =>
		request<Label>(`${base(mailboxId)}/labels`, {
			method: "POST",
			body: JSON.stringify(input),
		}),

	updateLabel: (mailboxId: string, id: string, input: Partial<Label>) =>
		request<Label>(`${base(mailboxId)}/labels/${encodeURIComponent(id)}`, {
			method: "PUT",
			body: JSON.stringify(input),
		}),

	deleteLabel: (mailboxId: string, id: string) =>
		request<{ status: string }>(
			`${base(mailboxId)}/labels/${encodeURIComponent(id)}`,
			{
				method: "DELETE",
			},
		),

	savedSearches: (mailboxId: string) =>
		request<
			Array<{ id: string; name: string; query: string; position: number }>
		>(`${base(mailboxId)}/saved-searches`),

	putSavedSearch: (
		mailboxId: string,
		id: string,
		input: { name: string; query: string; position?: number },
	) =>
		request(`${base(mailboxId)}/saved-searches/${encodeURIComponent(id)}`, {
			method: "PUT",
			body: JSON.stringify(input),
		}),

	deleteSavedSearch: (mailboxId: string, id: string) =>
		request(`${base(mailboxId)}/saved-searches/${encodeURIComponent(id)}`, {
			method: "DELETE",
		}),

	templates: (mailboxId: string) =>
		request<Array<{ id: string; name: string; subject: string; body: string }>>(
			`${base(mailboxId)}/templates`,
		),

	putTemplate: (
		mailboxId: string,
		id: string,
		input: { name: string; subject?: string; body?: string },
	) =>
		request(`${base(mailboxId)}/templates/${encodeURIComponent(id)}`, {
			method: "PUT",
			body: JSON.stringify(input),
		}),

	deleteTemplate: (mailboxId: string, id: string) =>
		request(`${base(mailboxId)}/templates/${encodeURIComponent(id)}`, {
			method: "DELETE",
		}),

	rules: (mailboxId: string) => request<any[]>(`${base(mailboxId)}/rules`),

	putRule: (mailboxId: string, id: string, rule: Record<string, unknown>) =>
		request(`${base(mailboxId)}/rules/${encodeURIComponent(id)}`, {
			method: "PUT",
			body: JSON.stringify(rule),
		}),

	deleteRule: (mailboxId: string, id: string) =>
		request(`${base(mailboxId)}/rules/${encodeURIComponent(id)}`, {
			method: "DELETE",
		}),

	blocked: (mailboxId: string) =>
		request<string[]>(`${base(mailboxId)}/blocked`),

	block: (mailboxId: string, address: string) =>
		request<{ address: string; moved: number }>(`${base(mailboxId)}/blocked`, {
			method: "POST",
			body: JSON.stringify({ address }),
		}),

	unblock: (mailboxId: string, address: string) =>
		request(`${base(mailboxId)}/blocked/${encodeURIComponent(address)}`, {
			method: "DELETE",
		}),

	preferences: (mailboxId: string) =>
		request<Record<string, any>>(`${base(mailboxId)}/preferences`),

	savePreferences: (mailboxId: string, preferences: Record<string, any>) =>
		request<Record<string, any>>(`${base(mailboxId)}/preferences`, {
			method: "PUT",
			body: JSON.stringify(preferences),
		}),

	saveDraft: (mailboxId: string, draft: Record<string, unknown>) =>
		request<{ id: string; scheduledAt: number | null }>(
			`${base(mailboxId)}/drafts`,
			{
				method: "POST",
				body: JSON.stringify(draft),
			},
		),

	deleteDraft: (mailboxId: string, id: string) =>
		request(`${base(mailboxId)}/drafts/${encodeURIComponent(id)}`, {
			method: "DELETE",
		}),

	cancelSchedule: (mailboxId: string, id: string) =>
		request(
			`${base(mailboxId)}/drafts/${encodeURIComponent(id)}/cancel-schedule`,
			{
				method: "POST",
			},
		),

	send: (mailboxId: string, message: Record<string, unknown>) =>
		request<{ id: string; status: string; scheduledAt?: number }>(
			`${base(mailboxId)}/messages`,
			{ method: "POST", body: JSON.stringify(message) },
		),

	unsubscribe: (mailboxId: string, threadId: string) =>
		request<{ status: string; method: string; target: string }>(
			`${base(mailboxId)}/unsubscribe`,
			{ method: "POST", body: JSON.stringify({ threadId }) },
		),

	summarize: (mailboxId: string, threadId: string) =>
		request<{
			available: boolean;
			reason?: string;
			bullets?: string[];
			quickReplies?: string[];
		}>(`${base(mailboxId)}/threads/${encodeURIComponent(threadId)}/summarize`, {
			method: "POST",
		}),

	rewrite: (mailboxId: string, text: string, tone?: string) =>
		request<{ available: boolean; text?: string }>(
			`${base(mailboxId)}/ai/rewrite`,
			{
				method: "POST",
				body: JSON.stringify({ text, tone }),
			},
		),

	exportBatch: (mailboxId: string, offset: number, limit: number) =>
		request<Message[]>(
			`${base(mailboxId)}/export?offset=${offset}&limit=${limit}`,
		),

	addresses: () =>
		request<{
			managed: boolean;
			addresses: Array<{ id: string; address: string }>;
		}>("/api/v1/addresses"),

	createAddress: (local: string) =>
		request<{ address: string }>("/api/v1/addresses", {
			method: "POST",
			body: JSON.stringify({ local }),
		}),

	/** Live updates. The socket only signals; the client refetches. */
	liveUrl: (mailboxId: string) => {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		return `${protocol}//${window.location.host}${base(mailboxId)}/live`;
	},
};
