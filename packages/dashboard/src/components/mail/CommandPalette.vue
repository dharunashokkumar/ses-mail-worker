<template>
	<Teleport to="body">
		<div class="scrim" @click="emit('close')" />
		<div class="palette" role="dialog" aria-label="Commands">
			<div class="search">
				<MailIcon name="search" :size="18" />
				<input
					ref="input"
					v-model="query"
					placeholder="Type a command, a folder, or words to search for…"
					@keydown.down.prevent="move(1)"
					@keydown.up.prevent="move(-1)"
					@keydown.enter.prevent="run(results[cursor])"
					@keydown.esc="emit('close')"
				/>
				<kbd>esc</kbd>
			</div>

			<ul class="results">
				<li v-for="(command, index) in results" :key="command.id">
					<button
						:class="{ 'is-cursor': index === cursor }"
						@click="run(command)"
						@mousemove="cursor = index"
					>
						<MailIcon :name="command.icon" :size="16" />
						<span class="text">
							<span class="title">{{ command.title }}</span>
							<span v-if="command.hint" class="hint">{{ command.hint }}</span>
						</span>
						<span class="group">{{ command.group }}</span>
					</button>
				</li>
				<li v-if="results.length === 0" class="none">Nothing matches.</li>
			</ul>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import MailIcon from "@/components/mail/MailIcon.vue";
import { useMailStore } from "@/stores/mail";
import { usePrefsStore } from "@/stores/prefs";

interface Command {
	id: string;
	title: string;
	group: string;
	icon: string;
	hint?: string;
	run: () => void;
}

const emit = defineEmits<{
	(event: "close"): void;
	(event: "compose"): void;
	(event: "settings"): void;
	(event: "notify", message: string): void;
}>();

const mail = useMailStore();
const prefs = usePrefsStore();
const query = ref("");
const cursor = ref(0);
const input = ref<HTMLInputElement | null>(null);

const FOLDER_NAMES: Record<string, string> = {
	inbox: "Inbox",
	snoozed: "Snoozed",
	drafts: "Drafts",
	scheduled: "Scheduled",
	sent: "Sent",
	archive: "Archive",
	spam: "Spam",
	trash: "Trash",
};

const commands = computed<Command[]>(() => {
	const list: Command[] = [
		{
			id: "compose",
			title: "Compose new message",
			group: "Mail",
			icon: "pen",
			run: () => emit("compose"),
		},
	];

	if (mail.openThreadId) {
		list.push(
			{
				id: "archive",
				title: "Archive this conversation",
				group: "Mail",
				icon: "archive",
				run: () => {
					void mail.mutate({
						threadIds: [mail.openThreadId],
						folderId: "archive",
					});
					emit("notify", "Archived");
				},
			},
			{
				id: "snooze",
				title: "Snooze until tomorrow morning",
				group: "Mail",
				icon: "clock",
				run: () => {
					const at = new Date();
					at.setDate(at.getDate() + 1);
					at.setHours(9, 0, 0, 0);
					void mail.mutate({
						threadIds: [mail.openThreadId],
						snoozeUntil: at.getTime(),
					});
					emit("notify", "Snoozed until tomorrow");
				},
			},
			{
				id: "unread",
				title: "Mark this conversation unread",
				group: "Mail",
				icon: "mail",
				run: () => {
					void mail.mutate({ threadIds: [mail.openThreadId], read: false });
					mail.closeThread();
				},
			},
			{
				id: "summarise",
				title: "Summarise this conversation",
				group: "Mail",
				icon: "ai",
				run: () => void mail.summarizeOpenThread(),
			},
		);
	}

	for (const folder of Object.keys(FOLDER_NAMES)) {
		list.push({
			id: `folder:${folder}`,
			title: `Go to ${FOLDER_NAMES[folder]}`,
			group: "Go to",
			icon: "folder",
			run: () =>
				mail.setScope({ folder, labelId: null, category: null, query: "" }),
		});
	}

	for (const label of mail.labels) {
		list.push({
			id: `label:${label.id}`,
			title: `Label: ${label.name}`,
			group: "Go to",
			icon: "tag",
			run: () =>
				mail.setScope({ labelId: label.id, category: null, query: "" }),
		});
	}

	for (const box of mail.mailboxes) {
		if (box.email === mail.mailboxId) continue;
		list.push({
			id: `mailbox:${box.email}`,
			title: `Switch to ${box.email}`,
			group: "Go to",
			icon: "mail",
			run: () => {
				window.location.href = `/mail/${encodeURIComponent(box.email)}/inbox`;
			},
		});
	}

	list.push(
		{
			id: "pane",
			title: `Reading pane: ${prefs.prefs.pane === "right" ? "bottom" : prefs.prefs.pane === "bottom" ? "off" : "right"}`,
			group: "View",
			icon: "box",
			run: () =>
				prefs.set(
					"pane",
					prefs.prefs.pane === "right"
						? "bottom"
						: prefs.prefs.pane === "bottom"
							? "off"
							: "right",
				),
		},
		{
			id: "theme",
			title: "Switch light / dark",
			group: "View",
			icon: "shield",
			run: () =>
				prefs.set("theme", prefs.prefs.theme === "dark" ? "light" : "dark"),
		},
		{
			id: "density",
			title: "Cycle density",
			group: "View",
			icon: "filter",
			run: () =>
				prefs.set(
					"density",
					prefs.prefs.density === "compact"
						? "cozy"
						: prefs.prefs.density === "cozy"
							? "relaxed"
							: "compact",
				),
		},
		{
			id: "conversations",
			title: prefs.prefs.conversations
				? "Turn conversations off"
				: "Turn conversations on",
			group: "View",
			icon: "box",
			run: () => {
				prefs.set("conversations", !prefs.prefs.conversations);
				mail.conversations = prefs.prefs.conversations;
				void mail.loadThreads();
			},
		},
		{
			id: "settings",
			title: "Open settings",
			group: "View",
			icon: "gear",
			run: () => emit("settings"),
		},
	);

	for (const saved of mail.savedSearches) {
		list.push({
			id: `saved:${saved.id}`,
			title: saved.name,
			hint: saved.query,
			group: "Search",
			icon: "search",
			run: () => mail.setScope({ query: saved.query }),
		});
	}

	return list;
});

const results = computed<Command[]>(() => {
	const text = query.value.trim().toLowerCase();
	if (!text) return commands.value.slice(0, 12);
	const matches = commands.value.filter((command) =>
		`${command.group} ${command.title} ${command.hint ?? ""}`
			.toLowerCase()
			.includes(text),
	);
	// Whatever is typed can always be a search.
	matches.push({
		id: "search",
		title: `Search mail for “${query.value.trim()}”`,
		group: "Search",
		icon: "search",
		run: () => mail.setScope({ query: query.value.trim() }),
	});
	return matches.slice(0, 14);
});

watch(results, () => {
	cursor.value = 0;
});

function move(delta: number) {
	const count = results.value.length;
	if (count === 0) return;
	cursor.value = (cursor.value + delta + count) % count;
}

function run(command?: Command) {
	if (!command) return;
	command.run();
	emit("close");
}

onMounted(async () => {
	await nextTick();
	input.value?.focus();
});
</script>

<style scoped>
.palette {
	position: fixed;
	top: 12vh;
	left: 50%;
	transform: translateX(-50%);
	z-index: 60;
	width: min(620px, calc(100vw - 32px));
	max-height: 66vh;
	display: flex;
	flex-direction: column;
	border: 1px solid var(--line);
	border-radius: var(--radius-lg);
	background: var(--raised);
	box-shadow: var(--shadow-lg);
	overflow: hidden;
}

.search {
	display: flex;
	align-items: center;
	gap: 11px;
	padding: 15px 17px;
	border-bottom: 1px solid var(--line);
	color: var(--dim);
}
.search input {
	flex: 1;
	border: 0;
	background: none;
	outline: none;
	font-size: 16px;
	color: var(--text);
	min-width: 0;
}
kbd {
	font-family: var(--mono);
	font-size: 10.5px;
	padding: 2px 6px;
	border: 1px solid var(--line);
	border-radius: 5px;
}

.results {
	margin: 0;
	padding: 6px;
	list-style: none;
	overflow-y: auto;
}
.results button {
	display: flex;
	align-items: center;
	gap: 11px;
	width: 100%;
	padding: 9px 11px;
	border-radius: var(--radius-sm);
	text-align: left;
}
.results button.is-cursor {
	background: color-mix(in srgb, var(--accent) 13%, transparent);
}

.text { min-width: 0; flex: 1; }
.title {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.hint {
	display: block;
	font-size: 11.5px;
	color: var(--dim);
}
.group {
	font-size: 10.5px;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--faint);
}

.none {
	padding: 22px;
	text-align: center;
	color: var(--dim);
}
</style>
