<template>
	<section class="list">
		<header class="list-head">
			<h1>{{ mail.scopeTitle }}</h1>
			<span class="total">{{ mail.threads.length }}{{ mail.hasMore ? "+" : "" }}</span>
			<span class="spacer" />

			<button
				class="chip chip-button"
				:class="{ 'is-on': unreadOnly }"
				@click="toggleFilter('is:unread')"
			>
				Unread
			</button>
			<button
				class="chip chip-button hide-narrow"
				:class="{ 'is-on': attachmentsOnly }"
				@click="toggleFilter('has:attachment')"
			>
				Has file
			</button>
			<button class="icon-btn" title="Refresh" @click="refresh">
				<MailIcon name="refresh" :size="16" />
			</button>
		</header>

		<Transition name="fade">
			<div v-if="mail.selection.length" class="bulkbar">
				<span>{{ mail.selection.length }} selected</span>
				<span class="spacer" />
				<button class="icon-btn" title="Archive" @click="bulk('archive')">
					<MailIcon name="archive" :size="16" />
				</button>
				<button class="icon-btn" title="Mark read" @click="bulk('read')">
					<MailIcon name="mail-open" :size="16" />
				</button>
				<button class="icon-btn" title="Delete" @click="bulk('trash')">
					<MailIcon name="trash" :size="16" />
				</button>
				<button class="icon-btn" title="Clear" @click="mail.clearSelection()">
					<MailIcon name="close" :size="16" />
				</button>
			</div>
		</Transition>

		<div class="rows" ref="scroller" @scroll.passive="onScroll">
			<template v-if="mail.loading && mail.threads.length === 0">
				<div v-for="n in 6" :key="n" class="skeleton" />
			</template>

			<p v-else-if="mail.error && mail.threads.length === 0" class="empty">
				{{ mail.error }}
			</p>

			<p v-else-if="mail.threads.length === 0" class="empty">
				{{ emptyMessage }}
			</p>

			<ThreadRow
				v-for="thread in mail.threads"
				:key="thread.threadId"
				:thread="thread"
				:labels="mail.labels"
				:active="thread.threadId === mail.openThreadId"
				:selected="mail.selection.includes(thread.threadId)"
				:outgoing="outgoing"
				@open="emit('open', $event)"
				@flag="flag"
				@swipe="onSwipe"
			/>

			<button v-if="mail.hasMore" class="more" :disabled="mail.loadingMore" @click="mail.loadMore()">
				{{ mail.loadingMore ? "Loading…" : "Load older mail" }}
			</button>
		</div>
	</section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import MailIcon from "@/components/mail/MailIcon.vue";
import ThreadRow from "@/components/mail/ThreadRow.vue";
import { useMailStore } from "@/stores/mail";
import type { Thread } from "@/types/mail";

const emit = defineEmits<{
	(event: "open", threadId: string): void;
	(event: "notify", message: string): void;
}>();

const mail = useMailStore();
const scroller = ref<HTMLElement | null>(null);

const outgoing = computed(() =>
	["sent", "drafts", "scheduled"].includes(mail.scope.folder),
);

const unreadOnly = computed(() => mail.scope.query.includes("is:unread"));
const attachmentsOnly = computed(() =>
	mail.scope.query.includes("has:attachment"),
);

const emptyMessage = computed(() => {
	if (mail.scope.query) return "No mail matches that search.";
	if (mail.scope.folder === "inbox") return "Inbox zero. Nothing waiting.";
	return "Nothing here.";
});

function toggleFilter(token: string) {
	const parts = mail.scope.query.split(/\s+/).filter(Boolean);
	const next = parts.includes(token)
		? parts.filter((part) => part !== token)
		: [...parts, token];
	mail.setScope({ query: next.join(" ") });
}

function refresh() {
	void mail.loadThreads();
	void mail.loadCounts();
}

function flag(thread: Thread) {
	void mail.mutate({ threadIds: [thread.threadId], starred: !thread.starred });
}

function bulk(action: "archive" | "read" | "trash") {
	const threadIds = [...mail.selection];
	if (action === "read") void mail.mutate({ threadIds, read: true });
	else if (action === "archive")
		void mail.mutate({ threadIds, folderId: "archive" });
	else void mail.mutate({ threadIds, folderId: "trash" });
	mail.clearSelection();
	emit(
		"notify",
		action === "trash"
			? "Moved to Trash"
			: action === "archive"
				? "Archived"
				: "Marked read",
	);
}

function onSwipe({ thread, action }: { thread: Thread; action: string }) {
	switch (action) {
		case "archive":
			void mail.mutate({ threadIds: [thread.threadId], folderId: "archive" });
			emit("notify", "Archived");
			break;
		case "trash":
			void mail.mutate({ threadIds: [thread.threadId], folderId: "trash" });
			emit("notify", "Moved to Trash");
			break;
		case "snooze":
			void mail.mutate({
				threadIds: [thread.threadId],
				snoozeUntil: Date.now() + 24 * 60 * 60 * 1000,
			});
			emit("notify", "Snoozed until tomorrow");
			break;
		case "flag":
			void mail.mutate({
				threadIds: [thread.threadId],
				starred: !thread.starred,
			});
			break;
		default:
			void mail.mutate({ threadIds: [thread.threadId], read: thread.unread });
	}
}

/** Load the next page as the list nears its end. */
function onScroll() {
	const element = scroller.value;
	if (!element || !mail.hasMore || mail.loadingMore) return;
	if (element.scrollTop + element.clientHeight > element.scrollHeight - 400) {
		void mail.loadMore();
	}
}
</script>

<style scoped>
.list {
	display: flex;
	flex-direction: column;
	min-height: 0;
	min-width: 0;
	background: var(--bg);
}

.list-head {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 14px 8px;
	flex: 0 0 auto;
}

h1 {
	margin: 0;
	font-size: 19px;
	font-weight: 650;
	letter-spacing: -0.02em;
}

.total {
	font-size: 12px;
	color: var(--dim);
	font-variant-numeric: tabular-nums;
}

.spacer { flex: 1; }

.bulkbar {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0 8px 6px;
	padding: 7px 12px;
	border-radius: var(--radius);
	background: color-mix(in srgb, var(--accent) 12%, var(--panel));
	font-size: 12.5px;
}

.rows {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	overflow-x: hidden;
	padding-bottom: 16px;
}

.empty {
	margin: 0;
	padding: 48px 24px;
	text-align: center;
	color: var(--dim);
}

.skeleton {
	height: 78px;
	margin: 0 8px 6px;
	border-radius: var(--radius);
	background: linear-gradient(
		90deg,
		var(--panel) 25%,
		var(--hover) 50%,
		var(--panel) 75%
	);
	background-size: 200% 100%;
	animation: shimmer 1.4s infinite;
}

@keyframes shimmer {
	to { background-position: -200% 0; }
}

.more {
	display: block;
	width: calc(100% - 16px);
	margin: 6px 8px;
	padding: 11px;
	border-radius: var(--radius);
	background: var(--panel);
	color: var(--dim);
	font-size: 12.5px;
	box-shadow: var(--shadow-sm);
}
.more:hover { color: var(--text); }

.only-narrow { display: none; }

@media (max-width: 900px) {
	.only-narrow { display: inline-flex; }
	.hide-narrow { display: none; }
}
</style>
