<template>
	<div
		class="shell"
		:class="[`pane-${prefs.prefs.pane}`, { 'is-reading': mail.openThreadId, 'is-drawer': drawer }]"
	>
		<header class="topbar">
			<button class="icon-btn only-narrow" title="Mailboxes" @click="drawer = !drawer">
				<MailIcon name="menu" :size="18" />
			</button>
			<span class="brand hide-narrow">{{ mail.mailboxId }}</span>

			<label class="search">
				<MailIcon name="search" :size="16" />
				<input
					v-model="searchText"
					type="search"
					placeholder="Search — from:priya, has:attachment, is:unread"
					@keydown.enter="runSearch"
					@search="runSearch"
				/>
				<button v-if="mail.scope.query" class="icon-btn" title="Clear" @click="clearSearch">
					<MailIcon name="close" :size="14" />
				</button>
				<button
					v-if="mail.scope.query"
					class="chip chip-button hide-narrow"
					title="Save this search"
					@click="saveSearch"
				>
					Save
				</button>
			</label>

			<button class="icon-btn hide-narrow" title="Commands (Ctrl K)" @click="palette = true">
				<kbd>⌘K</kbd>
			</button>
			<button class="icon-btn" title="Settings" @click="openSettings()">
				<MailIcon name="gear" :size="18" />
			</button>
		</header>

		<div class="grid">
			<MailSidebar
				class="side"
				@compose="composeNew"
				@settings="openSettings"
				@switch-mailbox="switchMailbox"
			/>

			<ThreadList class="list" @open="openThread" @notify="notify" />

			<ThreadView
				v-if="mail.openThreadId"
				class="reader"
				:addresses="addresses"
				:contacts="contacts"
				:templates="templates"
				:ai-enabled="aiEnabled"
				@close="closeThread"
				@notify="notify"
				@sent="notify('Sending…')"
				@manage-labels="openSettings('labels')"
			/>

			<div v-else-if="prefs.prefs.pane !== 'off'" class="placeholder">
				<MailIcon name="mail-open" :size="40" />
				<p>Select a conversation</p>
			</div>
		</div>

		<div v-if="drawer" class="drawer-scrim" @click="drawer = false" />

		<div class="composers">
			<ComposerWindow
				v-for="draft in floatingDrafts"
				:key="draft.uid"
				:draft="draft"
				:addresses="addresses"
				:contacts="contacts"
				:templates="templates"
				:ai-enabled="aiEnabled"
				@notify="notify"
				@sent="notify('Sending…')"
				@scheduled="onScheduled"
			/>
		</div>

		<CommandPalette
			v-if="palette"
			@close="palette = false"
			@compose="composeNew"
			@settings="openSettings()"
			@notify="notify"
		/>

		<SettingsSheet
			v-if="settings"
			:initial-section="settingsSection"
			@close="settings = false"
			@notify="notify"
			@switch-mailbox="switchMailbox"
		/>

		<div class="toasts">
			<TransitionGroup name="fade">
				<div v-for="toast in toasts" :key="toast.id" class="toast">
					<span>{{ toast.message }}</span>
					<button v-if="toast.action" @click="toast.action.run()">
						{{ toast.action.label }}
					</button>
				</div>
			</TransitionGroup>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import CommandPalette from "@/components/mail/CommandPalette.vue";
import ComposerWindow from "@/components/mail/ComposerWindow.vue";
import MailIcon from "@/components/mail/MailIcon.vue";
import MailSidebar from "@/components/mail/MailSidebar.vue";
import SettingsSheet from "@/components/mail/SettingsSheet.vue";
import ThreadList from "@/components/mail/ThreadList.vue";
import ThreadView from "@/components/mail/ThreadView.vue";
import { mailApi } from "@/services/mail";
import { useComposeStore } from "@/stores/compose";
import { useMailStore } from "@/stores/mail";
import { usePrefsStore } from "@/stores/prefs";
import type { Contact } from "@/types/mail";

interface Toast {
	id: number;
	message: string;
	action?: { label: string; run: () => void };
}

const route = useRoute();
const router = useRouter();
const mail = useMailStore();
const compose = useComposeStore();
const prefs = usePrefsStore();

const drawer = ref(false);
const palette = ref(false);
const settings = ref(false);
const settingsSection = ref("appearance");
const searchText = ref("");
const toasts = ref<Toast[]>([]);
const contacts = ref<Contact[]>([]);
const templates = ref<
	Array<{ id: string; name: string; subject: string; body: string }>
>([]);

const addresses = computed(() =>
	mail.mailboxes.length
		? mail.mailboxes.map((box) => box.email)
		: [mail.mailboxId],
);

const aiEnabled = computed(
	() => prefs.prefs.aiEnabled && (mail.identity?.ai ?? true),
);

const floatingDrafts = computed(() =>
	compose.windows.filter((draft) => !draft.inline),
);

let toastId = 0;

function notify(message: string, action?: Toast["action"], duration = 3200) {
	const id = ++toastId;
	toasts.value.push({ id, message, action });
	setTimeout(() => {
		toasts.value = toasts.value.filter((toast) => toast.id !== id);
	}, duration);
	return id;
}

function composeNew() {
	compose.openNew();
	drawer.value = false;
}

function openSettings(section?: string) {
	settingsSection.value = section ?? "appearance";
	settings.value = true;
	drawer.value = false;
}

function openThread(threadId: string) {
	void mail.openThread(threadId);
	drawer.value = false;
	void router.replace({
		name: "Mail",
		params: { mailboxId: mail.mailboxId, folder: mail.scope.folder },
		query: { thread: threadId },
	});
}

function closeThread() {
	mail.closeThread();
	void router.replace({
		name: "Mail",
		params: { mailboxId: mail.mailboxId, folder: mail.scope.folder },
	});
}

function runSearch() {
	mail.setScope({ query: searchText.value.trim() });
}

function clearSearch() {
	searchText.value = "";
	mail.setScope({ query: "" });
}

async function saveSearch() {
	const name = window.prompt("Name this search", mail.scope.query);
	if (!name) return;
	await mailApi.putSavedSearch(mail.mailboxId, crypto.randomUUID(), {
		name,
		query: mail.scope.query,
		position: mail.savedSearches.length,
	});
	await mail.loadSavedSearches();
	notify("Search saved to the sidebar");
}

function switchMailbox(email: string) {
	void router.push({
		name: "Mail",
		params: { mailboxId: email, folder: "inbox" },
	});
}

function onScheduled(at: number) {
	notify(`Scheduled for ${new Date(at).toLocaleString()}`);
	void mail.loadCounts();
}

/** Back online: send what was written offline, then replay queued changes. */
function onOnline() {
	void compose.drainOutbox();
	void mail.drainMutations();
}

/** Cmd/Ctrl+K only: no single-key shortcuts to fire while you are typing. */
function onKeydown(event: KeyboardEvent) {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		palette.value = !palette.value;
		return;
	}
	if (event.key === "Escape") {
		if (palette.value) palette.value = false;
		else if (settings.value) settings.value = false;
		else if (mail.openThreadId) closeThread();
	}
}

// The undo window: a toast holds the message until it actually leaves.
watch(
	() => compose.pending.length,
	(next, previous) => {
		if (next <= previous) return;
		const pending = compose.pending[compose.pending.length - 1];
		notify(
			"Sending…",
			{
				label: "Undo",
				run: () => {
					compose.undo(pending.uid);
					notify("Back in the composer");
				},
			},
			prefs.prefs.undoSeconds * 1000,
		);
	},
);

// Back, forward and shared links change only ?thread=, so follow it.
watch(
	() => route.query.thread,
	(value) => {
		const threadId = typeof value === "string" ? value : "";
		if (threadId === mail.openThreadId) return;
		if (threadId) void mail.openThread(threadId);
		else mail.closeThread();
	},
);

// The palette and saved searches change the scope; keep the box in step.
watch(
	() => mail.scope.query,
	(value) => {
		searchText.value = value;
	},
);

watch(
	() => route.params.mailboxId,
	async (value) => {
		const mailboxId = String(value ?? "");
		if (!mailboxId || mailboxId === mail.mailboxId) return;
		await start(mailboxId);
	},
);

watch(
	() => route.params.folder,
	(value) => {
		const folder = String(value ?? "inbox");
		if (folder && folder !== mail.scope.folder && !mail.scope.query) {
			mail.setScope({ folder, labelId: null, category: null });
		}
	},
);

async function start(mailboxId: string) {
	mail.disconnectLive();
	compose.mailboxId = mailboxId;
	mail.conversations = prefs.prefs.conversations;
	mail.scope = {
		folder: String(route.params.folder ?? "inbox"),
		labelId: null,
		category: null,
		query: "",
	};
	await prefs.hydrate(mailboxId);
	mail.conversations = prefs.prefs.conversations;
	await mail.bootstrap(mailboxId);

	const threadId = route.query.thread;
	if (typeof threadId === "string" && threadId) await mail.openThread(threadId);

	contacts.value = await fetchContacts(mailboxId);
	templates.value = await mailApi.templates(mailboxId).catch(() => []);
}

async function fetchContacts(mailboxId: string): Promise<Contact[]> {
	try {
		const response = await fetch(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/contacts`,
			{ headers: authHeader() },
		);
		if (!response.ok) return [];
		const rows = (await response.json()) as Array<{
			name?: string;
			email: string;
		}>;
		return rows.map((row) => ({ name: row.name ?? "", email: row.email }));
	} catch {
		return [];
	}
}

function authHeader(): Record<string, string> {
	const session = localStorage.getItem("session");
	if (!session) return {};
	try {
		return { Authorization: `Bearer ${JSON.parse(session).id}` };
	} catch {
		return {};
	}
}

onMounted(async () => {
	prefs.apply();
	document.addEventListener("keydown", onKeydown);
	window.addEventListener("online", onOnline);

	await mail.loadIdentity();
	await mail.loadMailboxes();

	const requested = String(route.params.mailboxId ?? "");
	const fallback = mail.identity?.email ?? mail.mailboxes[0]?.email ?? "";
	const mailboxId = requested || fallback;
	if (!mailboxId) {
		notify("No mailbox yet — create an address in Settings.", undefined, 6000);
		return;
	}
	if (!requested) {
		await router.replace({
			name: "Mail",
			params: { mailboxId, folder: "inbox" },
		});
	}
	await start(mailboxId);
	void compose.drainOutbox();

	// The installed app's "Compose" shortcut opens straight into a new message.
	if (route.query.compose !== undefined) composeNew();
});

onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown);
	window.removeEventListener("online", onOnline);
	mail.disconnectLive();
});
</script>

<style scoped>
.shell {
	display: flex;
	flex-direction: column;
	height: 100%;
	background: var(--bg);
}

.topbar {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 14px;
	flex: 0 0 auto;
}

.brand {
	font-weight: 600;
	font-size: 13.5px;
	white-space: nowrap;
}

.search {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 1;
	max-width: 620px;
	padding: 8px 13px;
	border: 1px solid transparent;
	border-radius: 999px;
	background: var(--panel);
	box-shadow: var(--shadow-sm);
	color: var(--dim);
}
.search:focus-within {
	border-color: color-mix(in srgb, var(--accent) 55%, transparent);
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
}
.search input {
	flex: 1;
	min-width: 0;
	border: 0;
	background: none;
	outline: none;
	color: var(--text);
}
.search input::-webkit-search-cancel-button { display: none; }

kbd {
	font-family: var(--mono);
	font-size: 10.5px;
	padding: 3px 6px;
	border: 1px solid var(--line);
	border-radius: 5px;
}

.grid {
	flex: 1;
	min-height: 0;
	display: grid;
	grid-template-areas: "side list read";
	grid-template-columns: 250px minmax(300px, 0.9fr) 1.4fr;
}
/* Grid children default to min-width:auto, which lets long subjects push the
   layout wider than the screen. */
.side,
.list,
.reader,
.placeholder { min-width: 0; }
.side { grid-area: side; }
.list { grid-area: list; }
.reader,
.placeholder { grid-area: read; }

.pane-bottom .grid {
	grid-template-areas: "side list" "side read";
	grid-template-columns: 250px 1fr;
	grid-template-rows: minmax(0, 1fr) minmax(0, 1.1fr);
}

.pane-off .grid {
	grid-template-areas: "side list";
	grid-template-columns: 250px 1fr;
}
.pane-off.is-reading .list { display: none; }
.pane-off.is-reading .reader { grid-area: list; }

.shell:not(.is-reading) .grid {
	grid-template-areas: "side list";
	grid-template-columns: 250px 1fr;
	grid-template-rows: minmax(0, 1fr);
}
.shell:not(.is-reading) .placeholder { display: none; }

.placeholder {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 12px;
	color: var(--faint);
	background: var(--panel);
	border-left: 1px solid var(--line);
}

.composers {
	position: fixed;
	right: 20px;
	bottom: 0;
	z-index: 45;
	display: flex;
	align-items: flex-end;
	gap: 14px;
}
.composers > * { width: min(560px, calc(100vw - 40px)); }

.toasts {
	position: fixed;
	left: 50%;
	bottom: 24px;
	transform: translateX(-50%);
	z-index: 70;
	display: flex;
	flex-direction: column;
	gap: 8px;
	align-items: center;
	pointer-events: none;
}

.toast {
	display: flex;
	align-items: center;
	gap: 16px;
	padding: 11px 16px;
	border-radius: 10px;
	background: #1d1d22;
	color: #fff;
	font-size: 13px;
	box-shadow: var(--shadow-lg);
	pointer-events: auto;
}
.toast button {
	color: #7fb2ff;
	font-weight: 600;
}

.drawer-scrim { display: none; }
.only-narrow { display: none; }

@media (max-width: 900px) {
	.only-narrow { display: inline-flex; }
	.hide-narrow { display: none; }

	.grid,
	.pane-bottom .grid,
	.pane-off .grid,
	.shell:not(.is-reading) .grid {
		grid-template-areas: "list";
		grid-template-columns: 1fr;
		grid-template-rows: minmax(0, 1fr);
	}

	.side {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		z-index: 46;
		width: 282px;
		transform: translateX(-100%);
		transition: transform 0.22s ease;
	}
	.is-drawer .side {
		transform: none;
		box-shadow: var(--shadow-lg);
	}
	.is-drawer .drawer-scrim {
		display: block;
		position: fixed;
		inset: 0;
		z-index: 45;
		background: rgba(12, 12, 22, 0.4);
	}

	.reader {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: var(--panel);
	}
	.placeholder { display: none; }

	.composers {
		right: 0;
		left: 0;
		top: 0;
		bottom: 0;
		z-index: 50;
	}
	.composers > * {
		width: 100%;
		height: 100%;
		max-height: 100%;
		border-radius: 0;
	}
}
</style>
