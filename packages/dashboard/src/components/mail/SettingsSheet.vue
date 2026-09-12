<template>
	<Teleport to="body">
		<div class="scrim" @click="emit('close')" />
		<aside class="sheet" role="dialog" aria-label="Settings">
			<header>
				<MailIcon name="gear" :size="18" />
				<h2>Settings</h2>
				<span class="spacer" />
				<button class="icon-btn" title="Close" @click="emit('close')">
					<MailIcon name="close" :size="18" />
				</button>
			</header>

			<nav class="tabs">
				<button
					v-for="tab in TABS"
					:key="tab.id"
					:class="{ 'is-on': section === tab.id }"
					@click="section = tab.id"
				>
					{{ tab.name }}
				</button>
			</nav>

			<div class="body">
				<!-- Appearance -->
				<section v-if="section === 'appearance'">
					<div class="row">
						<span class="label">Theme</span>
						<span class="segment">
							<button
								v-for="option in ['light', 'dark', 'system']"
								:key="option"
								:class="{ 'is-on': prefs.prefs.theme === option }"
								@click="prefs.set('theme', option as any)"
							>
								{{ option }}
							</button>
						</span>
					</div>
					<div class="row">
						<span class="label">Density</span>
						<span class="segment">
							<button
								v-for="option in ['compact', 'cozy', 'relaxed']"
								:key="option"
								:class="{ 'is-on': prefs.prefs.density === option }"
								@click="prefs.set('density', option as any)"
							>
								{{ option }}
							</button>
						</span>
					</div>
					<div class="row">
						<span class="label">Accent colour</span>
						<span class="swatches">
							<button
								v-for="accent in ACCENTS"
								:key="accent.id"
								class="swatch"
								:class="{ 'is-on': prefs.prefs.accent === accent.id }"
								:style="{ background: accent.id }"
								:title="accent.name"
								@click="prefs.set('accent', accent.id)"
							/>
						</span>
					</div>
					<div class="row">
						<span class="label">Reading pane</span>
						<span class="segment">
							<button
								v-for="option in ['right', 'bottom', 'off']"
								:key="option"
								:class="{ 'is-on': prefs.prefs.pane === option }"
								@click="prefs.set('pane', option as any)"
							>
								{{ option }}
							</button>
						</span>
					</div>
				</section>

				<!-- Reading -->
				<section v-else-if="section === 'reading'">
					<div class="row">
						<span class="label">
							Group into conversations
							<small>Off shows every message on its own row</small>
						</span>
						<button
							class="switch"
							:class="{ 'is-on': prefs.prefs.conversations }"
							@click="setConversations(!prefs.prefs.conversations)"
						>
							<i />
						</button>
					</div>
					<div class="row">
						<span class="label">
							Undo send window
							<small>How long a message waits before it leaves</small>
						</span>
						<span class="segment">
							<button
								v-for="seconds in [5, 10, 20, 30]"
								:key="seconds"
								:class="{ 'is-on': prefs.prefs.undoSeconds === seconds }"
								@click="prefs.set('undoSeconds', seconds)"
							>
								{{ seconds }}s
							</button>
						</span>
					</div>
					<div class="row">
						<span class="label">Swipe right</span>
						<span class="segment">
							<button
								v-for="option in ['read', 'flag', 'snooze']"
								:key="option"
								:class="{ 'is-on': prefs.prefs.swipeRight === option }"
								@click="prefs.set('swipeRight', option as any)"
							>
								{{ option }}
							</button>
						</span>
					</div>
					<div class="row">
						<span class="label">Swipe left</span>
						<span class="segment">
							<button
								v-for="option in ['archive', 'trash', 'snooze']"
								:key="option"
								:class="{ 'is-on': prefs.prefs.swipeLeft === option }"
								@click="prefs.set('swipeLeft', option as any)"
							>
								{{ option }}
							</button>
						</span>
					</div>
					<div class="row column">
						<span class="label">
							Signature
							<small>Added to the bottom of new messages</small>
						</span>
						<textarea
							class="field"
							rows="3"
							:value="prefs.prefs.signature"
							@change="prefs.set('signature', ($event.target as HTMLTextAreaElement).value)"
						/>
						<button
							class="switch"
							:class="{ 'is-on': prefs.prefs.signatureEnabled }"
							@click="prefs.set('signatureEnabled', !prefs.prefs.signatureEnabled)"
						>
							<i />
						</button>
					</div>
				</section>

				<!-- Labels -->
				<section v-else-if="section === 'labels'">
					<div v-for="label in mail.labels" :key="label.id" class="row">
						<span class="label">
							<span class="dot" :style="{ background: label.color }" />
							{{ label.name }}
						</span>
						<span class="inline-actions">
							<input
								type="color"
								:value="label.color"
								title="Colour"
								@change="recolour(label.id, ($event.target as HTMLInputElement).value)"
							/>
							<button class="icon-btn" title="Delete" @click="removeLabel(label.id)">
								<MailIcon name="trash" :size="15" />
							</button>
						</span>
					</div>
					<form class="row" @submit.prevent="addLabel">
						<input v-model="newLabel" class="field" placeholder="New label name" />
						<button class="btn" type="submit" :disabled="!newLabel.trim()">Add</button>
					</form>
				</section>

				<!-- Addresses -->
				<section v-else-if="section === 'addresses'">
					<p v-if="!addressesManaged" class="note">
						Add <code>CLOUDFLARE_API_TOKEN</code>, <code>CLOUDFLARE_ZONE_ID</code> and
						<code>MAIL_DOMAIN</code> as Worker secrets to create addresses from here.
					</p>
					<div v-for="box in mail.mailboxes" :key="box.id" class="row">
						<span class="label">
							{{ box.email }}
							<small>Receiving</small>
						</span>
						<button
							v-if="box.email !== mail.mailboxId"
							class="chip chip-button"
							@click="emit('switch-mailbox', box.email)"
						>
							Open
						</button>
					</div>
					<form v-if="addressesManaged" class="row" @submit.prevent="createAddress">
						<input v-model="newAddress" class="field" placeholder="new-name" />
						<span class="domain">@{{ domain }}</span>
						<button class="btn" type="submit" :disabled="!newAddress.trim()">Create</button>
					</form>
				</section>

				<!-- Filters -->
				<section v-else-if="section === 'filters'">
					<h3>Blocked senders</h3>
					<p v-if="blocked.length === 0" class="note">Nobody is blocked.</p>
					<div v-for="address in blocked" :key="address" class="row">
						<span class="label">{{ address }}</span>
						<button class="chip chip-button" @click="unblock(address)">Unblock</button>
					</div>

					<h3>Rules</h3>
					<p v-if="rules.length === 0" class="note">
						No rules yet. A rule files mail as it arrives — by sender, subject or list.
					</p>
					<div v-for="rule in rules" :key="rule.id" class="row">
						<span class="label">
							{{ rule.name }}
							<small>{{ describeRule(rule) }}</small>
						</span>
						<button class="icon-btn" title="Delete" @click="removeRule(rule.id)">
							<MailIcon name="trash" :size="15" />
						</button>
					</div>

					<form class="rule-form" @submit.prevent="addRule">
						<h4>New rule</h4>
						<div class="rule-line">
							<span>If</span>
							<select v-model="draftRule.field">
								<option value="from">sender</option>
								<option value="to">recipient</option>
								<option value="subject">subject</option>
								<option value="body">body</option>
								<option value="list">mailing list</option>
							</select>
							<select v-model="draftRule.operator">
								<option value="contains">contains</option>
								<option value="equals">is</option>
								<option value="endsWith">ends with</option>
								<option value="startsWith">starts with</option>
							</select>
							<input v-model="draftRule.value" class="field" placeholder="value" />
						</div>
						<div class="rule-line">
							<span>then move to</span>
							<select v-model="draftRule.folder">
								<option value="">(leave in Inbox)</option>
								<option v-for="folder in mail.folderCounts" :key="folder.id" :value="folder.id">
									{{ folder.name }}
								</option>
							</select>
							<span>and label</span>
							<select v-model="draftRule.label">
								<option value="">(none)</option>
								<option v-for="label in mail.labels" :key="label.id" :value="label.id">
									{{ label.name }}
								</option>
							</select>
						</div>
						<button class="btn" type="submit" :disabled="!draftRule.value.trim()">Add rule</button>
					</form>
				</section>

				<!-- Storage -->
				<section v-else-if="section === 'storage'">
					<div class="row">
						<span class="label">
							Messages
							<small>{{ mail.stats?.messages ?? 0 }} messages, {{ format(mail.stats?.messageBytes ?? 0) }} of 5 GB</small>
						</span>
						<span class="meter"><i :style="{ width: `${messagePercent}%` }" /></span>
					</div>
					<div class="row">
						<span class="label">
							Attachments in R2
							<small>{{ mail.stats?.attachmentCount ?? 0 }} files, {{ format(mail.stats?.attachmentBytes ?? 0) }} of 10 GB</small>
						</span>
						<span class="meter"><i :style="{ width: `${attachmentPercent}%` }" /></span>
					</div>
					<div class="row">
						<span class="label">
							Workers AI today
							<small>
								{{ mail.stats?.ai.used ?? 0 }} of {{ mail.stats?.ai.limit ?? 10000 }} neurons —
								summaries pause when the free tier runs out
							</small>
						</span>
						<span class="meter"><i :style="{ width: `${aiPercent}%` }" /></span>
					</div>
					<div class="row">
						<span class="label">
							Export everything
							<small>Downloads every message as JSON, built in your browser</small>
						</span>
						<button class="btn btn-quiet" :disabled="exporting" @click="exportAll">
							<MailIcon name="download" :size="15" />
							{{ exporting ? `Exporting… ${exported}` : "Export" }}
						</button>
					</div>
				</section>
			</div>
		</aside>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import MailIcon from "@/components/mail/MailIcon.vue";
import { mailApi } from "@/services/mail";
import { useMailStore } from "@/stores/mail";
import { ACCENTS, usePrefsStore } from "@/stores/prefs";

const props = defineProps<{ initialSection?: string }>();

const emit = defineEmits<{
	(event: "close"): void;
	(event: "notify", message: string): void;
	(event: "switch-mailbox", mailbox: string): void;
}>();

const TABS = [
	{ id: "appearance", name: "Appearance" },
	{ id: "reading", name: "Reading" },
	{ id: "labels", name: "Labels" },
	{ id: "addresses", name: "Addresses" },
	{ id: "filters", name: "Filters" },
	{ id: "storage", name: "Storage" },
];

const mail = useMailStore();
const prefs = usePrefsStore();

const section = ref(props.initialSection ?? "appearance");
const newLabel = ref("");
const newAddress = ref("");
const blocked = ref<string[]>([]);
const rules = ref<any[]>([]);
const exporting = ref(false);
const exported = ref(0);

const draftRule = reactive({
	field: "from",
	operator: "contains",
	value: "",
	folder: "",
	label: "",
});

const addressesManaged = computed(
	() => mail.identity?.addressManagement ?? false,
);
const domain = computed(() => mail.identity?.domain ?? "your-domain");

const messagePercent = computed(() =>
	Math.min(
		100,
		Math.round(((mail.stats?.messageBytes ?? 0) / 5 / 1024 ** 3) * 100),
	),
);
const attachmentPercent = computed(() =>
	Math.min(
		100,
		Math.round(((mail.stats?.attachmentBytes ?? 0) / 10 / 1024 ** 3) * 100),
	),
);
const aiPercent = computed(() =>
	Math.min(
		100,
		Math.round(
			((mail.stats?.ai.used ?? 0) / (mail.stats?.ai.limit ?? 10000)) * 100,
		),
	),
);

function format(bytes: number): string {
	if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
	if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${Math.round(bytes / 1024)} KB`;
}

function setConversations(value: boolean) {
	prefs.set("conversations", value);
	mail.conversations = value;
	void mail.loadThreads();
}

async function addLabel() {
	const name = newLabel.value.trim();
	if (!name) return;
	const colour = ACCENTS[mail.labels.length % ACCENTS.length].id;
	await mailApi.createLabel(mail.mailboxId, {
		id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
		name,
		color: colour,
	});
	newLabel.value = "";
	await mail.loadLabels();
}

async function recolour(id: string, color: string) {
	await mailApi.updateLabel(mail.mailboxId, id, { color });
	await mail.loadLabels();
}

async function removeLabel(id: string) {
	await mailApi.deleteLabel(mail.mailboxId, id);
	await mail.loadLabels();
	if (mail.scope.labelId === id)
		mail.setScope({ labelId: null, folder: "inbox" });
}

async function createAddress() {
	try {
		const result = await mailApi.createAddress(newAddress.value.trim());
		emit("notify", `${result.address} is now receiving mail`);
		newAddress.value = "";
		await mail.loadMailboxes();
	} catch (error) {
		emit("notify", (error as Error).message);
	}
}

async function loadFilters() {
	blocked.value = await mailApi.blocked(mail.mailboxId).catch(() => []);
	rules.value = await mailApi.rules(mail.mailboxId).catch(() => []);
}

async function unblock(address: string) {
	await mailApi.unblock(mail.mailboxId, address);
	await loadFilters();
}

function describeRule(rule: any): string {
	const condition = rule.conditions?.[0];
	const where = condition
		? `${condition.field} ${condition.operator} “${condition.value}”`
		: "";
	const moves = rule.actions?.folder ? ` → ${rule.actions.folder}` : "";
	const labels = rule.actions?.addLabels?.length
		? ` · ${rule.actions.addLabels.join(", ")}`
		: "";
	return `${where}${moves}${labels}`;
}

async function addRule() {
	const id = crypto.randomUUID();
	await mailApi.putRule(mail.mailboxId, id, {
		name: `${draftRule.field} ${draftRule.operator} ${draftRule.value}`,
		enabled: true,
		position: rules.value.length,
		matchAll: true,
		conditions: [
			{
				field: draftRule.field,
				operator: draftRule.operator,
				value: draftRule.value,
			},
		],
		actions: {
			folder: draftRule.folder || undefined,
			addLabels: draftRule.label ? [draftRule.label] : [],
		},
	});
	draftRule.value = "";
	await loadFilters();
	emit("notify", "Rule added — it runs on new mail");
}

async function removeRule(id: string) {
	await mailApi.deleteRule(mail.mailboxId, id);
	await loadFilters();
}

/** The export is assembled in the browser: no Worker CPU, no size limit. */
async function exportAll() {
	exporting.value = true;
	exported.value = 0;
	const all: unknown[] = [];
	try {
		for (let offset = 0; ; offset += 50) {
			const batch = await mailApi.exportBatch(mail.mailboxId, offset, 50);
			all.push(...batch);
			exported.value = all.length;
			if (batch.length < 50) break;
		}
		const blob = new Blob([JSON.stringify(all, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${mail.mailboxId}-${new Date().toISOString().slice(0, 10)}.json`;
		link.click();
		URL.revokeObjectURL(url);
		emit("notify", `Exported ${all.length} messages`);
	} catch (error) {
		emit("notify", (error as Error).message);
	} finally {
		exporting.value = false;
	}
}

watch(section, (value) => {
	if (value === "filters") void loadFilters();
	if (value === "storage") void mail.loadStats();
});

onMounted(() => {
	void mail.loadStats();
	if (section.value === "filters") void loadFilters();
});
</script>

<style scoped>
.sheet {
	position: fixed;
	top: 0;
	right: 0;
	bottom: 0;
	z-index: 60;
	width: min(460px, 100vw);
	display: flex;
	flex-direction: column;
	background: var(--panel);
	border-left: 1px solid var(--line);
	box-shadow: var(--shadow-lg);
}

header {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 14px 16px;
	border-bottom: 1px solid var(--line);
}
header h2 {
	margin: 0;
	font-size: 16px;
	font-weight: 650;
}
.spacer { flex: 1; }

.tabs {
	display: flex;
	gap: 2px;
	padding: 8px 10px;
	border-bottom: 1px solid var(--line);
	overflow-x: auto;
}
.tabs button {
	padding: 6px 11px;
	border-radius: 999px;
	font-size: 12.5px;
	color: var(--dim);
	white-space: nowrap;
}
.tabs button.is-on {
	background: color-mix(in srgb, var(--accent) 14%, transparent);
	color: var(--accent);
	font-weight: 600;
}

.body {
	flex: 1;
	overflow-y: auto;
	padding: 14px 16px 28px;
}

h3 {
	margin: 18px 0 6px;
	font-size: 11px;
	font-weight: 650;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--dim);
}
h3:first-child { margin-top: 0; }

h4 {
	margin: 0 0 8px;
	font-size: 13px;
}

.row {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 11px 0;
	border-bottom: 1px solid var(--line);
	flex-wrap: wrap;
}
.row.column { align-items: flex-start; }
.row:last-child { border-bottom: 0; }

.label {
	flex: 1;
	min-width: 140px;
	font-size: 13px;
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.label small {
	color: var(--dim);
	font-size: 11.5px;
}

.segment {
	display: inline-flex;
	gap: 3px;
	padding: 3px;
	border-radius: var(--radius-sm);
	background: var(--hover);
}
.segment button {
	padding: 5px 10px;
	border-radius: 6px;
	font-size: 12px;
	color: var(--dim);
	text-transform: capitalize;
}
.segment button.is-on {
	background: var(--panel);
	color: var(--text);
	font-weight: 600;
	box-shadow: var(--shadow-sm);
}

.swatches { display: flex; gap: 7px; }
.swatch {
	width: 21px;
	height: 21px;
	border-radius: 50%;
	border: 2px solid transparent;
	outline: 1px solid var(--line);
	outline-offset: 1px;
}
.swatch.is-on {
	border-color: var(--panel);
	outline: 2px solid var(--accent);
}

.switch {
	width: 40px;
	height: 23px;
	border-radius: 999px;
	background: var(--line);
	position: relative;
	flex: 0 0 auto;
	transition: background 0.15s ease;
}
.switch i {
	position: absolute;
	top: 2px;
	left: 2px;
	width: 19px;
	height: 19px;
	border-radius: 50%;
	background: #fff;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
	transition: left 0.15s ease;
}
.switch.is-on { background: var(--accent); }
.switch.is-on i { left: 19px; }

.dot {
	width: 10px;
	height: 10px;
	border-radius: 50%;
	display: inline-block;
	margin-right: 7px;
}

.inline-actions { display: flex; align-items: center; gap: 6px; }
.inline-actions input[type="color"] {
	width: 26px;
	height: 26px;
	padding: 0;
	border: 1px solid var(--line);
	border-radius: 6px;
	background: none;
}

.meter {
	width: 130px;
	height: 6px;
	border-radius: 4px;
	background: var(--hover);
	overflow: hidden;
}
.meter i {
	display: block;
	height: 100%;
	background: var(--accent);
}

.note {
	margin: 0 0 10px;
	font-size: 12.5px;
	color: var(--dim);
}
.note code {
	font-family: var(--mono);
	font-size: 11.5px;
	background: var(--hover);
	padding: 1px 5px;
	border-radius: 4px;
}

.domain { color: var(--dim); font-size: 12.5px; }

.rule-form {
	margin-top: 16px;
	padding: 12px;
	border: 1px solid var(--line);
	border-radius: var(--radius);
	background: var(--bg);
}
.rule-line {
	display: flex;
	align-items: center;
	gap: 7px;
	flex-wrap: wrap;
	margin-bottom: 9px;
	font-size: 12.5px;
	color: var(--dim);
}
.rule-line select {
	padding: 6px 8px;
	border: 1px solid var(--line);
	border-radius: var(--radius-sm);
	background: var(--panel);
	color: var(--text);
}
.rule-line .field { flex: 1; min-width: 120px; }
</style>
