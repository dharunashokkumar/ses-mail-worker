<template>
	<section class="reader">
		<header class="head">
			<div class="actions">
				<button class="icon-btn only-narrow" title="Back" @click="emit('close')">
					<MailIcon name="back" :size="18" />
				</button>
				<button class="icon-btn" title="Archive" @click="act('archive')">
					<MailIcon name="archive" :size="17" />
					<span class="label">Archive</span>
				</button>

				<DropMenu>
					<template #trigger="{ toggle }">
						<button class="icon-btn" title="Snooze" @click="toggle">
							<MailIcon name="clock" :size="17" />
							<span class="label">Snooze</span>
						</button>
					</template>
					<template #default="{ close: closeMenu }">
						<button v-for="option in snoozeOptions" :key="option.label" @click="snooze(option.at); closeMenu()">
							<MailIcon name="clock" :size="15" />
							<span>{{ option.label }}</span>
							<span class="menu-hint">{{ option.hint }}</span>
						</button>
					</template>
				</DropMenu>

				<DropMenu>
					<template #trigger="{ toggle }">
						<button class="icon-btn" title="Label" @click="toggle">
							<MailIcon name="tag" :size="17" />
							<span class="label">Label</span>
						</button>
					</template>
					<template #default>
						<button v-for="label in mail.labels" :key="label.id" @click="toggleLabel(label.id)">
							<MailIcon :name="hasLabel(label.id) ? 'check' : 'tag'" :size="15" />
							<span class="swatch" :style="{ background: label.color }" />
							<span>{{ label.name }}</span>
						</button>
						<hr />
						<button @click="emit('manage-labels')">
							<MailIcon name="plus" :size="15" />
							<span>New label…</span>
						</button>
					</template>
				</DropMenu>

				<button
					class="icon-btn"
					:class="{ 'is-on': thread?.starred }"
					title="Flag"
					@click="act('flag')"
				>
					<MailIcon name="star" :size="17" />
				</button>
				<button class="icon-btn" title="Mark unread" @click="act('unread')">
					<MailIcon name="mail" :size="17" />
				</button>
				<button class="icon-btn" title="Delete" @click="act('trash')">
					<MailIcon name="trash" :size="17" />
				</button>

				<span class="spacer" />

				<button
					v-if="aiEnabled"
					class="icon-btn"
					title="Summarise this thread"
					:disabled="mail.summaryPending"
					@click="mail.summarizeOpenThread()"
				>
					<MailIcon name="ai" :size="17" :class="{ spin: mail.summaryPending }" />
					<span class="label">Summarise</span>
				</button>
				<button class="icon-btn hide-narrow" title="Close" @click="emit('close')">
					<MailIcon name="close" :size="17" />
				</button>
			</div>

			<h2>{{ detail?.subject || thread?.subject || "(no subject)" }}</h2>

			<div class="meta">
				<AvatarBubble
					:email="counterpart?.sender"
					:name="counterpart?.sender_name ?? counterpart?.sender"
					:size="22"
				/>
				<strong>{{ counterpart?.sender_name || counterpart?.sender }}</strong>
				<span v-if="counterpart?.sender_name">{{ counterpart?.sender }}</span>
				<span v-if="messages.length > 1" class="chip">{{ messages.length }} messages</span>
				<span v-if="thread?.snoozedUntil" class="chip">
					Snoozed until {{ formatTime(thread.snoozedUntil) }}
				</span>
				<button
					v-if="latest?.list_unsubscribe"
					class="chip chip-button"
					@click="unsubscribe"
				>
					Unsubscribe
				</button>
				<button v-if="counterpart" class="chip chip-button" @click="block">Block sender</button>
			</div>

			<div v-if="thread?.spamReason" class="banner">
				<MailIcon name="spam" :size="15" />
				<span>Held as spam — {{ thread.spamReason }}</span>
				<button class="chip chip-button" @click="notSpam">Not spam</button>
			</div>
		</header>

		<div class="scroll">
			<div v-if="mail.summary" class="summary">
				<h3><MailIcon name="ai" :size="14" /> Thread summary</h3>
				<ul>
					<li v-for="(bullet, index) in mail.summary.bullets" :key="index">{{ bullet }}</li>
				</ul>
				<div v-if="mail.summary.quickReplies.length" class="quick">
					<button
						v-for="(reply, index) in mail.summary.quickReplies"
						:key="index"
						@click="quickReply(reply)"
					>
						{{ reply }}
					</button>
				</div>
			</div>

			<p v-if="mail.threadLoading && messages.length === 0" class="loading">Loading…</p>

			<MessageCard
				v-for="(message, index) in messages"
				:key="message.id"
				:message="message"
				:mailbox-id="mail.mailboxId"
				:collapsed="isCollapsed(message.id, index)"
				@toggle="toggle(message.id, index)"
			/>

			<div class="reply">
				<ComposerWindow
					v-if="inlineDraft"
					:draft="inlineDraft"
					:addresses="addresses"
					:contacts="contacts"
					:templates="templates"
					:ai-enabled="aiEnabled"
					@sent="emit('sent')"
					@notify="emit('notify', $event)"
				/>
				<div v-else class="reply-prompt">
					<button class="reply-open" @click="reply(false)">
						<MailIcon name="reply" :size="15" />
						<span>Reply to {{ counterpart?.sender_name || counterpart?.sender }}</span>
					</button>
					<button class="icon-btn" title="Reply all" @click="reply(true)">
						<MailIcon name="reply-all" :size="16" />
					</button>
					<button class="icon-btn" title="Forward" @click="forward">
						<MailIcon name="forward" :size="16" />
					</button>
				</div>
			</div>
		</div>
	</section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AvatarBubble from "@/components/mail/AvatarBubble.vue";
import ComposerWindow from "@/components/mail/ComposerWindow.vue";
import DropMenu from "@/components/mail/DropMenu.vue";
import MailIcon from "@/components/mail/MailIcon.vue";
import MessageCard from "@/components/mail/MessageCard.vue";
import type { Contact } from "@/components/mail/RecipientField.vue";
import { mailApi } from "@/services/mail";
import { useComposeStore } from "@/stores/compose";
import { useMailStore } from "@/stores/mail";

const props = defineProps<{
	addresses: string[];
	contacts: Contact[];
	templates: Array<{ id: string; name: string; subject: string; body: string }>;
	aiEnabled: boolean;
}>();

const emit = defineEmits<{
	(event: "close"): void;
	(event: "notify", message: string): void;
	(event: "sent"): void;
	(event: "manage-labels"): void;
}>();

const mail = useMailStore();
const compose = useComposeStore();

const detail = computed(() => mail.thread);
const messages = computed(() => detail.value?.messages ?? []);
const latest = computed(() => messages.value[messages.value.length - 1]);

/** The person on the other side: your own reply may be the newest message. */
const counterpart = computed(() => {
	const others = messages.value.filter(
		(message) => message.sender !== mail.mailboxId,
	);
	return others[others.length - 1] ?? latest.value;
});
const thread = computed(() =>
	mail.threads.find((item) => item.threadId === mail.openThreadId),
);

const expanded = ref<Set<string>>(new Set());

watch(
	() => mail.openThreadId,
	() => {
		expanded.value = new Set();
	},
);

/** Only the newest message is open by default, as in Mail. */
function isCollapsed(id: string, index: number): boolean {
	if (expanded.value.has(id)) return false;
	return index !== messages.value.length - 1;
}

function toggle(id: string, index: number) {
	const next = new Set(expanded.value);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	// Collapsing the newest message needs an explicit marker too.
	if (index === messages.value.length - 1 && !expanded.value.has(id))
		next.delete(id);
	expanded.value = next;
}

const inlineDraft = computed(() =>
	compose.windows.find(
		(window) => window.inline && window.threadId === mail.openThreadId,
	),
);

const snoozeOptions = computed(() => {
	const now = new Date();

	const later = new Date(now);
	later.setHours(18, 0, 0, 0);
	if (later.getTime() <= now.getTime()) later.setDate(later.getDate() + 1);

	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(9, 0, 0, 0);

	const weekend = new Date(now);
	weekend.setDate(weekend.getDate() + ((6 - weekend.getDay() + 7) % 7 || 7));
	weekend.setHours(9, 0, 0, 0);

	const nextWeek = new Date(now);
	nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7 || 7));
	nextWeek.setHours(9, 0, 0, 0);

	return [
		{
			label: "Later today",
			hint: formatTime(later.getTime()),
			at: later.getTime(),
		},
		{
			label: "Tomorrow",
			hint: formatTime(tomorrow.getTime()),
			at: tomorrow.getTime(),
		},
		{
			label: "This weekend",
			hint: formatTime(weekend.getTime()),
			at: weekend.getTime(),
		},
		{
			label: "Next week",
			hint: formatTime(nextWeek.getTime()),
			at: nextWeek.getTime(),
		},
	];
});

function formatTime(value: number): string {
	return new Date(value).toLocaleString([], {
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function hasLabel(id: string): boolean {
	return thread.value?.labels.includes(id) ?? false;
}

function toggleLabel(id: string) {
	const threadIds = [mail.openThreadId];
	void mail.mutate(
		hasLabel(id)
			? { threadIds, removeLabels: [id] }
			: { threadIds, addLabels: [id] },
	);
}

function act(action: "archive" | "trash" | "flag" | "unread") {
	const threadIds = [mail.openThreadId];
	switch (action) {
		case "archive":
			void mail.mutate({ threadIds, folderId: "archive" });
			emit("notify", "Archived");
			break;
		case "trash":
			void mail.mutate({ threadIds, folderId: "trash" });
			emit("notify", "Moved to Trash");
			break;
		case "flag":
			void mail.mutate({ threadIds, starred: !thread.value?.starred });
			break;
		default:
			void mail.mutate({ threadIds, read: false });
			mail.closeThread();
	}
}

function snooze(at: number) {
	void mail.mutate({ threadIds: [mail.openThreadId], snoozeUntil: at });
	emit("notify", `Snoozed until ${formatTime(at)}`);
}

async function unsubscribe() {
	try {
		const result = await mailApi.unsubscribe(mail.mailboxId, mail.openThreadId);
		if (result.method === "http") {
			window.open(result.target, "_blank", "noopener");
			emit("notify", "Opened the unsubscribe page");
		} else {
			emit("notify", `Unsubscribe request sent to ${result.target}`);
		}
	} catch (error) {
		emit("notify", (error as Error).message);
	}
}

async function block() {
	if (!counterpart.value) return;
	await mailApi.block(mail.mailboxId, counterpart.value.sender);
	emit(
		"notify",
		`${counterpart.value.sender} blocked — their mail now goes to Spam`,
	);
	void mail.loadThreads();
	mail.closeThread();
}

function notSpam() {
	void mail.mutate({ threadIds: [mail.openThreadId], folderId: "inbox" });
	emit("notify", "Moved back to the Inbox");
}

function reply(all: boolean) {
	if (!latest.value) return;
	compose.openReply(thread.value ?? null, latest.value, { all, inline: true });
}

function forward() {
	if (latest.value) compose.openForward(latest.value);
}

function quickReply(text: string) {
	if (!latest.value) return;
	const draft = compose.openReply(thread.value ?? null, latest.value, {
		inline: true,
	});
	compose.update(draft.uid, { html: `<p>${text}</p>${draft.html}` });
}
</script>

<style scoped>
.reader {
	display: flex;
	flex-direction: column;
	min-height: 0;
	background: var(--panel);
	border-left: 1px solid var(--line);
}

.head {
	padding: 10px 16px 12px;
	border-bottom: 1px solid var(--line);
	flex: 0 0 auto;
}

.actions {
	display: flex;
	align-items: center;
	gap: 2px;
	flex-wrap: wrap;
	margin-bottom: 8px;
}
.actions .spacer { flex: 1; }
.actions .label {
	font-size: 12.5px;
}

h2 {
	margin: 0;
	font-size: 20px;
	font-weight: 650;
	letter-spacing: -0.02em;
	line-height: 1.25;
}

.meta {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
	margin-top: 8px;
	font-size: 12.5px;
	color: var(--dim);
}
.meta strong { color: var(--text); font-weight: 600; }

.banner {
	display: flex;
	align-items: center;
	gap: 9px;
	margin-top: 10px;
	padding: 9px 12px;
	border-radius: var(--radius-sm);
	background: color-mix(in srgb, var(--danger) 12%, transparent);
	color: var(--danger);
	font-size: 12.5px;
}

.scroll {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 14px 16px 20px;
}

.summary {
	margin-bottom: 14px;
	padding: 12px 14px;
	border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line));
	border-radius: var(--radius);
	background: color-mix(in srgb, var(--accent) 7%, transparent);
}
.summary h3 {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0 0 7px;
	font-size: 12px;
	font-weight: 650;
	color: var(--accent);
}
.summary ul {
	margin: 0;
	padding-left: 18px;
	font-size: 13px;
	line-height: 1.6;
}

.quick {
	display: flex;
	flex-wrap: wrap;
	gap: 7px;
	margin-top: 10px;
}
.quick button {
	padding: 6px 13px;
	border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line));
	border-radius: 999px;
	background: var(--panel);
	color: var(--accent);
	font-size: 12.5px;
}
.quick button:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }

.loading {
	color: var(--dim);
	text-align: center;
	padding: 24px;
}

.reply { margin-top: 12px; }

.reply-prompt {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 10px 12px;
	border: 1px solid var(--line);
	border-radius: var(--radius);
	background: var(--panel);
}

.reply-open {
	display: flex;
	align-items: center;
	gap: 9px;
	flex: 1;
	color: var(--dim);
	font-size: 13px;
	text-align: left;
}
.reply-open:hover { color: var(--text); }

.swatch {
	width: 9px;
	height: 9px;
	border-radius: 50%;
}

.only-narrow { display: none; }

@media (max-width: 900px) {
	.reader { border-left: 0; }
	.only-narrow { display: inline-flex; }
	.hide-narrow { display: none; }
	.actions .label { display: none; }
}
</style>
