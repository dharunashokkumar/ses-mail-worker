<template>
	<article
		class="row"
		:class="{ 'is-unread': thread.unread, 'is-active': active, 'is-selected': selected }"
		:style="{ transform: dx ? `translateX(${dx}px)` : undefined }"
		@click="emit('open', thread.threadId)"
		@pointerdown="onPointerDown"
		@pointermove="onPointerMove"
		@pointerup="onPointerUp"
		@pointercancel="onPointerUp"
	>
		<div v-if="dx" class="swipe-hint" :class="dx > 0 ? 'right' : 'left'" :style="{ background: swipeColour }">
			{{ swipeLabel }}
		</div>

		<div class="lead">
			<span class="unread-dot" />
			<button
				class="pick"
				:class="{ 'is-picked': selected }"
				:title="selected ? 'Deselect' : 'Select'"
				:aria-label="selected ? 'Deselect this conversation' : 'Select this conversation'"
				:aria-pressed="selected"
				@click.stop="emit('select', thread)"
			>
				<AvatarBubble
					v-if="!selected"
					:name="thread.senderName ?? displayName"
					:email="thread.sender"
					:size="34"
				/>
				<span v-else class="picked"><MailIcon name="check" :size="18" /></span>
			</button>
		</div>

		<div class="body">
			<div class="line">
				<span class="who">{{ displayName }}</span>
				<span v-if="thread.messageCount > 1" class="count">{{ thread.messageCount }}</span>
				<span class="when">{{ when }}</span>
			</div>
			<div class="subject">{{ thread.subject || "(no subject)" }}</div>
			<div class="preview">{{ thread.preview }}</div>
			<div v-if="badges.length" class="badges">
				<span
					v-for="badge in badges"
					:key="badge.key"
					class="chip"
					:style="badge.color ? { color: badge.color } : undefined"
				>
					<span v-if="badge.color" class="dot" :style="{ background: badge.color }" />
					{{ badge.text }}
				</span>
			</div>
		</div>

		<div class="marks">
			<MailIcon v-if="thread.hasAttachments" name="clip" :size="14" />
			<MailIcon v-if="thread.pinned" name="pin" :size="14" />
			<button
				class="icon-btn star"
				:class="{ 'is-on': thread.starred }"
				:title="thread.starred ? 'Remove flag' : 'Flag'"
				@click.stop="emit('flag', thread)"
			>
				<MailIcon name="star" :size="15" />
			</button>
		</div>
	</article>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import AvatarBubble from "@/components/mail/AvatarBubble.vue";
import MailIcon from "@/components/mail/MailIcon.vue";
import { usePrefsStore } from "@/stores/prefs";
import type { Label, Thread } from "@/types/mail";

const props = defineProps<{
	thread: Thread;
	active: boolean;
	selected: boolean;
	labels: Label[];
	outgoing: boolean;
}>();

const emit = defineEmits<{
	(event: "open", threadId: string): void;
	(event: "select", thread: Thread): void;
	(event: "flag", thread: Thread): void;
	(event: "swipe", payload: { thread: Thread; action: string }): void;
}>();

const prefs = usePrefsStore();

const displayName = computed(() => {
	if (props.outgoing) {
		const recipients = props.thread.recipient
			.split(",")
			.map((value) => value.trim());
		const first = recipients[0] ?? "";
		const extra = recipients.length > 1 ? ` +${recipients.length - 1}` : "";
		return `To ${first}${extra}`;
	}
	if (props.thread.senderName) return props.thread.senderName;
	const address = props.thread.sender;
	const local = address.split("@")[0] ?? address;
	return local
		.split(/[._-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
});

/** Time for today, weekday for this week, date beyond that — as mail apps do. */
const when = computed(() => {
	const date = new Date(props.thread.date);
	if (Number.isNaN(date.getTime())) return "";
	const now = new Date();
	const sameDay = date.toDateString() === now.toDateString();
	if (sameDay) {
		return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
	const days = (now.getTime() - date.getTime()) / 86_400_000;
	if (days < 7) return date.toLocaleDateString([], { weekday: "short" });
	if (date.getFullYear() === now.getFullYear()) {
		return date.toLocaleDateString([], { day: "numeric", month: "short" });
	}
	return date.toLocaleDateString([], { year: "numeric", month: "short" });
});

const badges = computed(() => {
	const out: Array<{ key: string; text: string; color?: string }> = [];
	for (const id of props.thread.labels) {
		const label = props.labels.find((entry) => entry.id === id);
		if (label)
			out.push({ key: `l-${id}`, text: label.name, color: label.color });
	}
	if (props.thread.category) {
		const category = props.thread.category;
		out.push({
			key: "category",
			text: category.charAt(0).toUpperCase() + category.slice(1),
		});
	}
	if (props.thread.snoozedUntil) {
		out.push({
			key: "snoozed",
			text: `Snoozed · ${new Date(props.thread.snoozedUntil).toLocaleString(
				[],
				{
					weekday: "short",
					hour: "2-digit",
					minute: "2-digit",
				},
			)}`,
		});
	}
	if (props.thread.scheduledAt) {
		out.push({
			key: "scheduled",
			text: `Sends ${new Date(props.thread.scheduledAt).toLocaleString([], {
				weekday: "short",
				hour: "2-digit",
				minute: "2-digit",
			})}`,
		});
	}
	const delivery = props.thread.deliveryState;
	if (delivery && delivery !== "accepted" && props.outgoing) {
		out.push({
			key: "delivery",
			text: delivery.charAt(0).toUpperCase() + delivery.slice(1),
		});
	}
	if (props.thread.spamReason) {
		out.push({ key: "spam", text: props.thread.spamReason });
	}
	return out;
});

// --- swipe actions (touch) ------------------------------------------------

const dx = ref(0);
const startX = ref(0);
const tracking = ref(false);

const swipeAction = computed(() =>
	dx.value > 0 ? prefs.prefs.swipeRight : prefs.prefs.swipeLeft,
);

const swipeLabel = computed(
	() =>
		({
			archive: "Archive",
			trash: "Delete",
			snooze: "Snooze",
			flag: "Flag",
			read: props.thread.unread ? "Mark read" : "Mark unread",
		})[swipeAction.value],
);

const swipeColour = computed(
	() =>
		({
			archive: "var(--success)",
			trash: "var(--danger)",
			snooze: "#a45cd6",
			flag: "var(--warning)",
			read: "var(--accent)",
		})[swipeAction.value],
);

function onPointerDown(event: PointerEvent) {
	if (event.pointerType === "mouse") return;
	tracking.value = true;
	startX.value = event.clientX;
}

function onPointerMove(event: PointerEvent) {
	if (!tracking.value) return;
	const delta = event.clientX - startX.value;
	if (Math.abs(delta) < 8) return;
	dx.value = Math.max(-140, Math.min(140, delta));
}

function onPointerUp() {
	if (!tracking.value) return;
	tracking.value = false;
	const delta = dx.value;
	dx.value = 0;
	if (Math.abs(delta) > 72) {
		emit("swipe", { thread: props.thread, action: swipeAction.value });
	}
}
</script>

<style scoped>
.row {
	position: relative;
	display: grid;
	grid-template-columns: auto 1fr auto;
	gap: 11px;
	align-items: flex-start;
	padding: calc(11px * var(--row-gap)) 14px;
	margin: 0 8px 6px;
	border-radius: var(--radius);
	background: var(--panel);
	box-shadow: var(--shadow-sm);
	cursor: pointer;
	overflow: hidden;
	touch-action: pan-y;
	transition: transform 0.12s ease, background 0.12s ease;
}
.row:hover { background: var(--hover); }
.row.is-active {
	background: color-mix(in srgb, var(--accent) 13%, var(--panel));
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
}
.row.is-selected { box-shadow: 0 0 0 2px var(--accent); }

.swipe-hint {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	padding: 0 18px;
	color: #fff;
	font-weight: 600;
	font-size: 12.5px;
	z-index: -1;
}
.swipe-hint.left { justify-content: flex-end; }

.lead {
	display: flex;
	align-items: center;
	gap: 8px;
	padding-top: 2px;
}

.pick {
	display: block;
	padding: 0;
	border-radius: 50%;
	line-height: 0;
}
.pick:hover { box-shadow: 0 0 0 2px var(--accent); }

.picked {
	display: grid;
	place-items: center;
	width: 34px;
	height: 34px;
	border-radius: 50%;
	background: var(--accent);
	color: var(--on-accent);
}

.unread-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: transparent;
}
.row.is-unread .unread-dot { background: var(--accent); }

.body { min-width: 0; }

.line {
	display: flex;
	align-items: baseline;
	gap: 8px;
}

.who {
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.row.is-unread .who { font-weight: 700; }

.count {
	font-size: 11px;
	color: var(--dim);
	font-variant-numeric: tabular-nums;
}

.when {
	margin-left: auto;
	font-size: 11.5px;
	color: var(--dim);
	white-space: nowrap;
}

.subject {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	margin-top: 1px;
}
.row.is-unread .subject { font-weight: 600; }

.preview {
	color: var(--dim);
	font-size: 13px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	margin-top: 2px;
}

.badges {
	display: flex;
	flex-wrap: wrap;
	gap: 5px;
	margin-top: 7px;
}

.dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
}

.marks {
	display: flex;
	align-items: center;
	gap: 2px;
	color: var(--faint);
}
.star { padding: 4px; }

:root[data-density="compact"] .preview,
:root[data-density="compact"] .badges {
	display: none;
}
</style>
