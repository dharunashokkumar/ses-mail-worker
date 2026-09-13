<template>
	<div class="recipients" @click="focusInput">
		<label>{{ label }}</label>
		<div class="chips">
			<span v-for="(address, index) in modelValue" :key="`${address}-${index}`" class="recipient">
				<AvatarBubble :email="address" :size="18" />
				<span class="address">{{ address }}</span>
				<button class="remove" title="Remove" @click.stop="remove(index)">
					<MailIcon name="close" :size="12" />
				</button>
			</span>
			<input
				ref="input"
				v-model="draft"
				:placeholder="modelValue.length ? '' : placeholder"
				autocomplete="off"
				spellcheck="false"
				@keydown.enter.prevent="commit()"
				@keydown.tab="onTab"
				@keydown="onKey"
				@blur="commit()"
				@input="onInput"
			/>
		</div>
		<slot name="actions" />

		<ul v-if="suggestions.length && draft" class="suggestions">
			<li v-for="(contact, index) in suggestions" :key="contact.email">
				<button
					:class="{ 'is-active': index === highlighted }"
					@mousedown.prevent="commit(contact.email)"
				>
					<AvatarBubble :name="contact.name" :email="contact.email" :size="24" />
					<span class="meta">
						<strong>{{ contact.name || contact.email }}</strong>
						<span>{{ contact.email }}</span>
					</span>
				</button>
			</li>
		</ul>
	</div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import AvatarBubble from "@/components/mail/AvatarBubble.vue";
import MailIcon from "@/components/mail/MailIcon.vue";
import type { Contact } from "@/types/mail";

const props = withDefaults(
	defineProps<{
		modelValue: string[];
		label: string;
		placeholder?: string;
		contacts: Contact[];
	}>(),
	{ placeholder: "Name or email" },
);

const emit =
	defineEmits<(event: "update:modelValue", value: string[]) => void>();

const draft = ref("");
const input = ref<HTMLInputElement | null>(null);
const suggestions = ref<Contact[]>([]);
const highlighted = ref(0);

function focusInput() {
	input.value?.focus();
}

function onInput() {
	const query = draft.value.trim().toLowerCase();
	highlighted.value = 0;
	suggestions.value = query
		? props.contacts
				.filter(
					(contact) =>
						!props.modelValue.includes(contact.email) &&
						`${contact.name} ${contact.email}`.toLowerCase().includes(query),
				)
				.slice(0, 5)
		: [];
}

function onKey(event: KeyboardEvent) {
	if (event.key === "," || event.key === ";") {
		event.preventDefault();
		commit();
		return;
	}
	if (
		event.key === "Backspace" &&
		draft.value === "" &&
		props.modelValue.length
	) {
		emit("update:modelValue", props.modelValue.slice(0, -1));
		return;
	}
	if (!suggestions.value.length) return;
	if (event.key === "ArrowDown") {
		event.preventDefault();
		highlighted.value = (highlighted.value + 1) % suggestions.value.length;
	} else if (event.key === "ArrowUp") {
		event.preventDefault();
		highlighted.value =
			(highlighted.value - 1 + suggestions.value.length) %
			suggestions.value.length;
	}
}

function onTab(event: KeyboardEvent) {
	if (draft.value.trim()) {
		event.preventDefault();
		commit();
	}
}

/** Accept the highlighted suggestion, or whatever was typed. */
function commit(explicit?: string) {
	const chosen =
		explicit ??
		(suggestions.value[highlighted.value]?.email || draft.value.trim());
	if (!chosen) return;
	if (!props.modelValue.includes(chosen)) {
		emit("update:modelValue", [...props.modelValue, chosen]);
	}
	draft.value = "";
	suggestions.value = [];
	highlighted.value = 0;
}

function remove(index: number) {
	const next = [...props.modelValue];
	next.splice(index, 1);
	emit("update:modelValue", next);
}
</script>

<style scoped>
.recipients {
	position: relative;
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 9px 0;
	border-bottom: 1px solid var(--line);
	cursor: text;
}

label {
	width: 42px;
	padding-top: 5px;
	font-size: 12px;
	color: var(--dim);
	flex: 0 0 auto;
}

.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 5px;
	align-items: center;
	flex: 1;
	min-width: 0;
}

.recipient {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 3px 7px 3px 3px;
	border-radius: 999px;
	background: var(--hover);
	font-size: 12.5px;
	max-width: 100%;
}
.recipient .address {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.remove {
	color: var(--dim);
	line-height: 0;
	padding: 1px;
}
.remove:hover { color: var(--danger); }

input {
	flex: 1;
	min-width: 130px;
	padding: 5px 2px;
	border: 0;
	background: none;
	outline: none;
}

.suggestions {
	position: absolute;
	top: 100%;
	left: 42px;
	right: 0;
	z-index: 20;
	margin: 4px 0 0;
	padding: 4px;
	list-style: none;
	border: 1px solid var(--line);
	border-radius: var(--radius);
	background: var(--raised);
	box-shadow: var(--shadow-md);
	max-height: 220px;
	overflow-y: auto;
}

.suggestions button {
	display: flex;
	align-items: center;
	gap: 9px;
	width: 100%;
	padding: 7px 9px;
	border-radius: var(--radius-sm);
	text-align: left;
}
.suggestions button:hover,
.suggestions button.is-active { background: var(--hover); }

.meta { min-width: 0; }
.meta strong {
	display: block;
	font-size: 13px;
}
.meta span {
	display: block;
	font-size: 11.5px;
	color: var(--dim);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
