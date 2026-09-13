<template>
	<section
		class="composer"
		:class="{ 'is-inline': draft.inline, 'is-minimised': draft.minimised }"
		@dragover.prevent="dragging = true"
		@dragleave="dragging = false"
		@drop.prevent="onDrop"
	>
		<header v-if="!draft.inline" class="bar" @dblclick="toggleMinimise">
			<MailIcon name="pen" :size="14" />
			<span class="title">{{ draft.subject || "New message" }}</span>
			<button class="icon-btn" :title="draft.minimised ? 'Expand' : 'Minimise'" @click="toggleMinimise">
				<MailIcon name="chevron" :size="15" />
			</button>
			<button class="icon-btn" title="Close" @click="close">
				<MailIcon name="close" :size="15" />
			</button>
		</header>

		<div v-show="!draft.minimised" class="fields">
			<div v-if="!draft.inline" class="from">
				<label>From</label>
				<select :value="draft.from" @change="onFrom">
					<option v-for="address in addresses" :key="address" :value="address">
						{{ address }}
					</option>
				</select>
			</div>

			<RecipientField
				:model-value="draft.to"
				label="To"
				:contacts="contacts"
				@update:model-value="update({ to: $event })"
			>
				<template #actions>
					<button class="chip chip-button" @click="update({ showCc: !draft.showCc })">
						Cc/Bcc
					</button>
				</template>
			</RecipientField>

			<template v-if="draft.showCc">
				<RecipientField
					:model-value="draft.cc"
					label="Cc"
					:contacts="contacts"
					@update:model-value="update({ cc: $event })"
				/>
				<RecipientField
					:model-value="draft.bcc"
					label="Bcc"
					:contacts="contacts"
					@update:model-value="update({ bcc: $event })"
				/>
			</template>

			<div v-if="!draft.inline" class="subject">
				<label>Subject</label>
				<input
					:value="draft.subject"
					placeholder="Subject"
					@input="update({ subject: ($event.target as HTMLInputElement).value })"
				/>
			</div>
		</div>

		<div v-show="!draft.minimised" class="toolbar">
			<button class="icon-btn" :class="{ 'is-on': editor?.isActive('bold') }" title="Bold"
				@click="editor?.chain().focus().toggleBold().run()"><b>B</b></button>
			<button class="icon-btn" :class="{ 'is-on': editor?.isActive('italic') }" title="Italic"
				@click="editor?.chain().focus().toggleItalic().run()"><i>I</i></button>
			<button class="icon-btn" :class="{ 'is-on': editor?.isActive('bulletList') }" title="List"
				@click="editor?.chain().focus().toggleBulletList().run()">
				<MailIcon name="list" :size="16" />
			</button>
			<button class="icon-btn" :class="{ 'is-on': editor?.isActive('blockquote') }" title="Quote"
				@click="editor?.chain().focus().toggleBlockquote().run()">
				<MailIcon name="quote" :size="16" />
			</button>
			<button class="icon-btn" :class="{ 'is-on': editor?.isActive('link') }" title="Link" @click="setLink">
				<MailIcon name="link" :size="16" />
			</button>
			<span class="divider" />
			<button class="icon-btn" title="Attach a file" @click="picker?.click()">
				<MailIcon name="clip" :size="16" />
			</button>

			<DropMenu v-if="templates.length" :style="{ top: 'calc(100% + 4px)', left: '0' }">
				<template #trigger="{ toggle }">
					<button class="icon-btn" title="Templates" @click="toggle">
						<MailIcon name="draft" :size="16" />
					</button>
				</template>
				<template #default="{ close: closeMenu }">
					<button
						v-for="template in templates"
						:key="template.id"
						@click="applyTemplate(template); closeMenu()"
					>
						<MailIcon name="draft" :size="15" />
						<span>{{ template.name }}</span>
					</button>
				</template>
			</DropMenu>

			<button v-if="aiEnabled" class="icon-btn" title="Rewrite with AI" :disabled="rewriting" @click="rewrite">
				<MailIcon name="ai" :size="16" :class="{ spin: rewriting }" />
			</button>

			<span class="spacer" />
			<span class="hint">Markdown shortcuts on</span>
		</div>

		<div v-show="!draft.minimised" class="editor" :class="{ 'is-dragging': dragging }">
			<EditorContent :editor="editor" />
		</div>

		<div v-if="draft.attachments.length && !draft.minimised" class="attachments">
			<span v-for="attachment in draft.attachments" :key="attachment.filename" class="attachment">
				<MailIcon name="clip" :size="13" />
				{{ attachment.filename }}
				<button title="Remove" @click="compose.removeAttachment(draft.uid, attachment.filename)">
					<MailIcon name="close" :size="12" />
				</button>
			</span>
		</div>

		<footer v-show="!draft.minimised" class="foot">
			<span class="send-group">
				<button class="btn send" :disabled="!canSend" @click="send">
					<MailIcon name="send" :size="15" />
					Send
				</button>
				<DropMenu :style="{ bottom: 'calc(100% + 6px)', left: '0' }">
					<template #trigger="{ toggle }">
						<button class="btn caret" :disabled="!canSend" title="Send later" @click="toggle">
							<MailIcon name="chevron" :size="14" />
						</button>
					</template>
					<template #default="{ close: closeMenu }">
						<button v-for="option in scheduleOptions" :key="option.label" @click="schedule(option.at); closeMenu()">
							<MailIcon name="clock" :size="15" />
							<span>{{ option.label }}</span>
							<span class="menu-hint">{{ option.hint }}</span>
						</button>
					</template>
				</DropMenu>
			</span>

			<DropMenu :style="{ bottom: 'calc(100% + 6px)', left: '0' }">
				<template #trigger="{ toggle }">
					<button class="btn btn-quiet" :class="{ 'is-on': draft.remindAt }" title="Remind me" @click="toggle">
						<MailIcon name="bell" :size="15" />
						<span class="hide-narrow">{{ draft.remindAt ? "Reminder set" : "Remind me" }}</span>
					</button>
				</template>
				<template #default="{ close: closeMenu }">
					<button @click="update({ remindAt: Date.now() + 2 * 86400000 }); closeMenu()">
						<MailIcon name="bell" :size="15" /><span>If no reply in 2 days</span>
					</button>
					<button @click="update({ remindAt: Date.now() + 7 * 86400000 }); closeMenu()">
						<MailIcon name="bell" :size="15" /><span>If no reply in a week</span>
					</button>
					<hr v-if="draft.remindAt" />
					<button v-if="draft.remindAt" @click="update({ remindAt: null }); closeMenu()">
						<MailIcon name="close" :size="15" /><span>Clear reminder</span>
					</button>
				</template>
			</DropMenu>

			<span class="status">{{ savedLabel }}</span>

			<button class="icon-btn" title="Discard" @click="discard">
				<MailIcon name="trash" :size="16" />
			</button>
		</footer>

		<input ref="picker" type="file" multiple class="sr-only" @change="onPick" />
	</section>
</template>

<script setup lang="ts">
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import DropMenu from "@/components/mail/DropMenu.vue";
import MailIcon from "@/components/mail/MailIcon.vue";
import RecipientField from "@/components/mail/RecipientField.vue";
import { mailApi } from "@/services/mail";
import {
	type ComposerWindow as Draft,
	useComposeStore,
} from "@/stores/compose";
import type { Contact } from "@/types/mail";

const props = defineProps<{
	draft: Draft;
	addresses: string[];
	contacts: Contact[];
	templates: Array<{ id: string; name: string; subject: string; body: string }>;
	aiEnabled: boolean;
}>();

const emit = defineEmits<{
	(event: "sent"): void;
	(event: "scheduled", at: number): void;
	(event: "notify", message: string): void;
}>();

const compose = useComposeStore();
const picker = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const rewriting = ref(false);
let saveTimer: number | undefined;

const editor = useEditor({
	content: props.draft.html,
	extensions: [
		StarterKit.configure({ heading: { levels: [2, 3] } }),
		Link.configure({ openOnClick: false, autolink: true }),
	],
	editorProps: {
		attributes: { class: "prose-body", "aria-label": "Message body" },
	},
	onUpdate: ({ editor: instance }) => {
		update({ html: instance.getHTML() });
	},
});

const canSend = computed(
	() =>
		props.draft.to.length + props.draft.cc.length + props.draft.bcc.length > 0,
);

const savedLabel = computed(() => {
	if (props.draft.saving) return "Saving…";
	if (!props.draft.savedAt) return "";
	const seconds = Math.round((Date.now() - props.draft.savedAt) / 1000);
	return seconds < 60 ? "Draft saved" : "Draft saved a while ago";
});

const scheduleOptions = computed(() => {
	const now = new Date();

	const tonight = new Date(now);
	tonight.setHours(20, 0, 0, 0);
	if (tonight.getTime() < now.getTime()) tonight.setDate(tonight.getDate() + 1);

	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(8, 0, 0, 0);

	const monday = new Date(now);
	monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
	monday.setHours(8, 0, 0, 0);

	const label = (date: Date) =>
		date.toLocaleString([], {
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
		});

	return [
		{ label: "Tonight", hint: label(tonight), at: tonight.getTime() },
		{
			label: "Tomorrow morning",
			hint: label(tomorrow),
			at: tomorrow.getTime(),
		},
		{ label: "Monday morning", hint: label(monday), at: monday.getTime() },
	];
});

function update(patch: Partial<Draft>) {
	compose.update(props.draft.uid, patch);
	queueSave();
}

/** Drafts save themselves a couple of seconds after you stop typing. */
function queueSave() {
	if (props.draft.inline) return;
	window.clearTimeout(saveTimer);
	saveTimer = window.setTimeout(() => {
		void compose.saveDraft(props.draft.uid);
	}, 2000);
}

function onFrom(event: Event) {
	update({ from: (event.target as HTMLSelectElement).value });
}

function toggleMinimise() {
	compose.update(props.draft.uid, { minimised: !props.draft.minimised });
}

function close() {
	void compose.saveDraft(props.draft.uid);
	compose.close(props.draft.uid);
}

function discard() {
	if (props.draft.id)
		void mailApi.deleteDraft(compose.mailboxId, props.draft.id);
	compose.close(props.draft.uid);
	emit("notify", "Draft discarded");
}

function send() {
	window.clearTimeout(saveTimer);
	compose.queueSend(props.draft.uid);
	emit("sent");
}

async function schedule(at: number) {
	window.clearTimeout(saveTimer);
	try {
		await compose.schedule(props.draft.uid, at);
		emit("scheduled", at);
	} catch (error) {
		// The window is still open, so nothing written is lost.
		emit("notify", `Could not schedule: ${(error as Error).message}`);
	}
}

function setLink() {
	const previous = editor.value?.getAttributes("link").href ?? "";
	const href = window.prompt("Link address", previous);
	if (href === null) return;
	if (href === "") {
		editor.value?.chain().focus().extendMarkRange("link").unsetLink().run();
		return;
	}
	editor.value?.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

function applyTemplate(template: { subject: string; body: string }) {
	if (template.subject && !props.draft.subject)
		update({ subject: template.subject });
	editor.value?.commands.insertContent(template.body);
}

async function rewrite() {
	const text = editor.value?.getText() ?? "";
	if (!text.trim()) return;
	rewriting.value = true;
	try {
		const result = await mailApi.rewrite(compose.mailboxId, text);
		if (result.available && result.text) {
			editor.value?.commands.setContent(
				result.text
					.split(/\n{2,}/)
					.map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
					.join(""),
			);
			emit("notify", "Rewritten with Workers AI");
		} else {
			emit("notify", "Today's AI budget is used up — try again tomorrow.");
		}
	} catch (error) {
		emit("notify", (error as Error).message);
	} finally {
		rewriting.value = false;
	}
}

async function onPick(event: Event) {
	const files = Array.from((event.target as HTMLInputElement).files ?? []);
	await compose.attach(props.draft.uid, files);
	(event.target as HTMLInputElement).value = "";
}

async function onDrop(event: DragEvent) {
	dragging.value = false;
	const files = Array.from(event.dataTransfer?.files ?? []);
	if (files.length) await compose.attach(props.draft.uid, files);
}

watch(
	() => props.draft.uid,
	() => editor.value?.commands.setContent(props.draft.html),
);

onBeforeUnmount(() => {
	window.clearTimeout(saveTimer);
	editor.value?.destroy();
});
</script>

<style scoped>
.composer {
	display: flex;
	flex-direction: column;
	background: var(--panel);
	border: 1px solid var(--line);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-lg);
	overflow: hidden;
	max-height: min(560px, 90vh);
}

.composer.is-inline {
	box-shadow: none;
	border-radius: var(--radius);
	max-height: none;
}

.bar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 9px 10px 9px 14px;
	background: var(--hover);
	font-size: 12.5px;
	font-weight: 600;
	cursor: default;
}
.bar .title {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.fields {
	padding: 2px 14px;
	overflow-y: auto;
	flex: 0 0 auto;
}

.from,
.subject {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 9px 0;
	border-bottom: 1px solid var(--line);
}
.from label,
.subject label {
	width: 42px;
	font-size: 12px;
	color: var(--dim);
}
.from select,
.subject input {
	flex: 1;
	border: 0;
	background: none;
	outline: none;
	min-width: 0;
}

.toolbar {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 7px 12px;
	border-bottom: 1px solid var(--line);
	flex-wrap: wrap;
}
.toolbar .divider {
	width: 1px;
	height: 18px;
	margin: 0 5px;
	background: var(--line);
}
.toolbar .spacer { flex: 1; }
.toolbar .hint {
	font-size: 11px;
	color: var(--faint);
}

.editor {
	flex: 1;
	min-height: 140px;
	overflow-y: auto;
	padding: 12px 14px;
}
.editor.is-dragging {
	outline: 2px dashed var(--accent);
	outline-offset: -6px;
}

.attachments {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	padding: 0 14px 10px;
}
.attachment {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 5px 8px;
	border: 1px solid var(--line);
	border-radius: var(--radius-sm);
	font-size: 12px;
	background: var(--bg);
}
.attachment button { color: var(--dim); line-height: 0; }
.attachment button:hover { color: var(--danger); }

.foot {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 14px;
	border-top: 1px solid var(--line);
	flex-wrap: wrap;
}

.send-group {
	display: inline-flex;
	border-radius: var(--radius-sm);
	/* No overflow clipping here: the send-later menu opens out of this box. */
}
.send-group .send {
	border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}
.send-group .caret {
	border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	padding: 8px 9px;
	border-left: 1px solid color-mix(in srgb, var(--on-accent) 30%, transparent);
}

.status {
	margin-left: auto;
	font-size: 11.5px;
	color: var(--dim);
}

:deep(.prose-body) {
	outline: none;
	line-height: 1.62;
	min-height: 120px;
}
:deep(.prose-body p) { margin: 0 0 10px; }
:deep(.prose-body blockquote) {
	margin: 0 0 10px 8px;
	padding-left: 12px;
	border-left: 2px solid var(--line);
	color: var(--dim);
}
:deep(.prose-body ul),
:deep(.prose-body ol) { margin: 0 0 10px; padding-left: 22px; }
:deep(.prose-body a) { color: var(--accent); }

@media (max-width: 720px) {
	.hide-narrow { display: none; }
}
</style>
