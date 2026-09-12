<template>
	<aside class="sidebar">
		<div class="switcher">
			<DropMenu :style="{ top: 'calc(100% + 6px)', left: '0', right: '0' }">
				<template #trigger="{ toggle }">
					<button class="switcher-btn" @click="toggle">
						<AvatarBubble :email="mail.mailboxId" :size="28" />
						<span class="switcher-text">
							<strong>{{ mail.mailboxId }}</strong>
							<span>{{ mail.unreadInbox ? `${mail.unreadInbox} unread` : "Up to date" }}</span>
						</span>
						<MailIcon name="chevron" :size="14" />
					</button>
				</template>
				<template #default="{ close }">
					<button
						v-for="box in mail.mailboxes"
						:key="box.id"
						@click="select(box.email, close)"
					>
						<MailIcon :name="box.email === mail.mailboxId ? 'check' : 'mail'" :size="15" />
						<span>{{ box.email }}</span>
					</button>
					<hr />
					<button @click="emit('settings', 'addresses'); close()">
						<MailIcon name="plus" :size="15" />
						<span>Add an address…</span>
					</button>
				</template>
			</DropMenu>
		</div>

		<div class="compose-wrap">
			<button class="btn compose" @click="emit('compose')">
				<MailIcon name="pen" :size="16" />
				<span>Compose</span>
			</button>
		</div>

		<nav class="nav">
			<button
				v-for="folder in folders"
				:key="folder.id"
				class="nav-item"
				:class="{ 'is-active': isFolder(folder.id) }"
				@click="goFolder(folder.id)"
			>
				<MailIcon :name="folder.icon" :size="16" />
				<span class="nav-label">{{ folder.name }}</span>
				<span v-if="folderBadge(folder.id)" class="nav-count">{{ folderBadge(folder.id) }}</span>
			</button>

			<p class="nav-heading">Categories</p>
			<button
				v-for="category in CATEGORIES"
				:key="category.id"
				class="nav-item"
				:class="{ 'is-active': mail.scope.category === category.id }"
				@click="goCategory(category.id)"
			>
				<MailIcon name="box" :size="16" />
				<span class="nav-label">{{ category.name }}</span>
				<span v-if="categoryBadge(category.id)" class="nav-count">
					{{ categoryBadge(category.id) }}
				</span>
			</button>

			<p class="nav-heading">
				Labels
				<button class="heading-action" title="New label" @click="emit('settings', 'labels')">
					<MailIcon name="plus" :size="13" />
				</button>
			</p>
			<button
				v-for="label in mail.labels"
				:key="label.id"
				class="nav-item"
				:class="{ 'is-active': mail.scope.labelId === label.id }"
				@click="goLabel(label.id)"
			>
				<span class="dot" :style="{ background: label.color }" />
				<span class="nav-label">{{ label.name }}</span>
				<span v-if="labelBadge(label.id)" class="nav-count">{{ labelBadge(label.id) }}</span>
			</button>
			<p v-if="mail.labels.length === 0" class="nav-empty">No labels yet</p>

			<template v-if="mail.savedSearches.length">
				<p class="nav-heading">Saved searches</p>
				<button
					v-for="saved in mail.savedSearches"
					:key="saved.id"
					class="nav-item"
					@click="mail.setScope({ query: saved.query, folder: 'inbox', labelId: null, category: null })"
				>
					<MailIcon name="search" :size="16" />
					<span class="nav-label">{{ saved.name }}</span>
				</button>
			</template>
		</nav>

		<div class="foot">
			<div class="foot-row">
				<span>Storage</span>
				<span>{{ storageLabel }}</span>
			</div>
			<div class="bar"><i :style="{ width: `${storagePercent}%` }" /></div>
			<div class="foot-row">
				<button class="chip chip-button" @click="emit('settings', 'appearance')">
					<MailIcon name="gear" :size="14" />
					Settings
				</button>
				<span v-if="mail.offline" class="offline">
					<MailIcon name="offline" :size="14" /> Offline
				</span>
			</div>
		</div>
	</aside>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import AvatarBubble from "@/components/mail/AvatarBubble.vue";
import DropMenu from "@/components/mail/DropMenu.vue";
import MailIcon from "@/components/mail/MailIcon.vue";
import { useMailStore } from "@/stores/mail";

const emit = defineEmits<{
	(event: "compose"): void;
	(event: "settings", section?: string): void;
	(event: "switch-mailbox", mailbox: string): void;
}>();

const mail = useMailStore();

const FOLDER_ORDER = [
	{ id: "inbox", icon: "inbox" },
	{ id: "snoozed", icon: "clock" },
	{ id: "drafts", icon: "draft" },
	{ id: "scheduled", icon: "clock" },
	{ id: "sent", icon: "send" },
	{ id: "archive", icon: "archive" },
	{ id: "spam", icon: "spam" },
	{ id: "trash", icon: "trash" },
];

const CATEGORIES = [
	{ id: "newsletters", name: "Newsletters" },
	{ id: "notifications", name: "Notifications" },
	{ id: "receipts", name: "Receipts" },
];

/** Built-in folders first, in reading order, then any the user made. */
const folders = computed(() => {
	const known = mail.folderCounts;
	const ordered = FOLDER_ORDER.map((entry) => {
		const match = known.find((folder) => folder.id === entry.id);
		return match
			? { ...entry, name: match.name }
			: {
					...entry,
					name: entry.id.charAt(0).toUpperCase() + entry.id.slice(1),
				};
	});
	const custom = known
		.filter((folder) => !FOLDER_ORDER.some((entry) => entry.id === folder.id))
		.map((folder) => ({ id: folder.id, name: folder.name, icon: "folder" }));
	return [...ordered, ...custom];
});

const isFolder = (id: string) =>
	!mail.scope.labelId &&
	!mail.scope.category &&
	!mail.scope.query &&
	mail.scope.folder === id;

function folderBadge(id: string): number {
	const folder = mail.folderCounts.find((entry) => entry.id === id);
	if (!folder) return 0;
	// Drafts, Sent and Scheduled are never "unread"; their size is the useful number.
	return ["drafts", "scheduled", "sent"].includes(id)
		? folder.total
		: folder.unread;
}

const categoryBadge = (id: string) =>
	mail.counts?.categories.find((entry) => entry.id === id)?.unread ?? 0;

const labelBadge = (id: string) =>
	mail.counts?.labels.find((entry) => entry.id === id)?.unread ?? 0;

function goFolder(id: string) {
	mail.setScope({ folder: id, labelId: null, category: null, query: "" });
}

function goCategory(id: string) {
	mail.setScope({ folder: "inbox", labelId: null, category: id, query: "" });
}

function goLabel(id: string) {
	mail.setScope({ labelId: id, category: null, query: "" });
}

function select(email: string, close: () => void) {
	close();
	emit("switch-mailbox", email);
}

const DO_STORAGE_LIMIT = 5 * 1024 ** 3;

const storagePercent = computed(() => {
	const used = mail.stats?.messageBytes ?? 0;
	return Math.min(100, Math.round((used / DO_STORAGE_LIMIT) * 100));
});

const storageLabel = computed(() => {
	const used = mail.stats?.messageBytes ?? 0;
	const format = (bytes: number) => {
		if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
		if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
		return `${Math.round(bytes / 1024)} KB`;
	};
	return `${format(used)} of 5 GB`;
});

onMounted(() => {
	void mail.loadStats();
});
</script>

<style scoped>
.sidebar {
	display: flex;
	flex-direction: column;
	min-height: 0;
	background: var(--side);
	border-right: 1px solid var(--line);
}

.switcher {
	padding: 10px 10px 6px;
}

.switcher-btn {
	display: flex;
	align-items: center;
	gap: 9px;
	width: 100%;
	padding: 8px;
	border-radius: var(--radius);
	text-align: left;
}
.switcher-btn:hover { background: var(--hover); }

.switcher-text {
	min-width: 0;
	flex: 1;
}
.switcher-text strong {
	display: block;
	font-size: 13px;
	font-weight: 600;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.switcher-text span {
	display: block;
	font-size: 11.5px;
	color: var(--dim);
}

.compose-wrap { padding: 4px 10px 8px; }
.compose {
	width: 100%;
	padding: 11px;
	border-radius: var(--radius);
	font-size: 13.5px;
}

.nav {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 4px 8px 12px;
}

.nav-item {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	padding: calc(7px * var(--row-gap)) 10px;
	border-radius: var(--radius-sm);
	color: var(--text);
	font-size: 13px;
	text-align: left;
}
.nav-item:hover { background: var(--hover); }
.nav-item.is-active {
	background: color-mix(in srgb, var(--accent) 13%, transparent);
	color: var(--accent);
	font-weight: 600;
}

.nav-label {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.nav-count {
	font-size: 11.5px;
	color: var(--dim);
	font-variant-numeric: tabular-nums;
}
.nav-item.is-active .nav-count { color: inherit; }

.nav-heading {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 14px 0 4px;
	padding: 0 10px;
	font-size: 10.5px;
	font-weight: 650;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--dim);
}

.heading-action {
	margin-left: auto;
	color: var(--dim);
	line-height: 0;
	padding: 2px;
	border-radius: 5px;
}
.heading-action:hover { background: var(--hover); color: var(--text); }

.nav-empty {
	margin: 0;
	padding: 2px 10px 0;
	font-size: 12px;
	color: var(--faint);
}

.dot {
	width: 9px;
	height: 9px;
	border-radius: 50%;
	flex: 0 0 auto;
	margin: 0 3px;
}

.foot {
	border-top: 1px solid var(--line);
	padding: 10px 12px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.foot-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	font-size: 11.5px;
	color: var(--dim);
}

.bar {
	height: 5px;
	border-radius: 4px;
	background: var(--hover);
	overflow: hidden;
}
.bar i {
	display: block;
	height: 100%;
	background: var(--accent);
	border-radius: 4px;
}

.offline {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	color: var(--warning);
}
</style>
