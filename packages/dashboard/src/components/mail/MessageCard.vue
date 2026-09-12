<template>
	<article class="message" :class="{ 'is-collapsed': collapsed }">
		<header class="head" @click="emit('toggle')">
			<AvatarBubble :name="message.sender" :email="message.sender" :size="34" />
			<div class="who">
				<strong>{{ senderName }}</strong>
				<span>{{ recipientLine }}</span>
			</div>
			<time :datetime="message.date">{{ when }}</time>
			<MailIcon name="chevron" :size="15" class="caret" />
		</header>

		<div v-show="!collapsed" class="content">
			<MessageBody
				:body="message.body"
				:attachments="message.attachments"
				:mailbox-id="mailboxId"
				:message-id="message.id"
			/>

			<div v-if="fileAttachments.length" class="attachments">
				<a
					v-for="attachment in fileAttachments"
					:key="attachment.id"
					class="attachment"
					:href="attachmentUrl(attachment.id)"
					:download="attachment.filename"
				>
					<MailIcon name="clip" :size="14" />
					<span class="name">{{ attachment.filename }}</span>
					<span class="size">{{ formatSize(attachment.size) }}</span>
				</a>
			</div>

			<div v-if="message.delivery_state" class="delivery">
				<MailIcon name="send" :size="14" />
				<span class="state" :class="`state-${message.delivery_state}`">
					{{ deliveryLabel }}
				</span>
				<span class="detail">{{ message.delivery_detail }}</span>
			</div>
		</div>
	</article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AvatarBubble from "@/components/mail/AvatarBubble.vue";
import MailIcon from "@/components/mail/MailIcon.vue";
import MessageBody from "@/components/mail/MessageBody.vue";
import type { Message } from "@/types/mail";

const props = defineProps<{
	message: Message;
	collapsed: boolean;
	mailboxId: string;
}>();

const emit = defineEmits<(event: "toggle") => void>();

const senderName = computed(() => {
	const address = props.message.sender ?? "";
	if (address === props.mailboxId) return "You";
	if (props.message.sender_name) return props.message.sender_name;
	const local = address.split("@")[0] ?? address;
	return local
		.split(/[._-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
});

const recipientLine = computed(() => {
	const to = props.message.recipient ? `to ${props.message.recipient}` : "";
	return props.message.cc ? `${to} · cc ${props.message.cc}` : to;
});

const when = computed(() => {
	const date = new Date(props.message.date);
	if (Number.isNaN(date.getTime())) return props.message.date;
	return date.toLocaleString([], {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
});

// Inline images are already shown in the body; only real files get a chip.
const fileAttachments = computed(() =>
	props.message.attachments.filter(
		(attachment) => (attachment.disposition ?? "attachment") !== "inline",
	),
);

const DELIVERY_LABELS: Record<string, string> = {
	accepted: "Accepted",
	delivered: "Delivered",
	opened: "Opened",
	bounced: "Bounced",
	complained: "Marked as spam",
	failed: "Failed",
};

const deliveryLabel = computed(
	() =>
		DELIVERY_LABELS[props.message.delivery_state ?? ""] ??
		props.message.delivery_state,
);

function attachmentUrl(attachmentId: string): string {
	return `/api/v1/mailboxes/${encodeURIComponent(props.mailboxId)}/emails/${encodeURIComponent(
		props.message.id,
	)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function formatSize(bytes: number): string {
	if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	if (bytes > 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}
</script>

<style scoped>
.message {
	border: 1px solid var(--line);
	border-radius: var(--radius);
	background: var(--panel);
	margin-bottom: 10px;
	overflow: hidden;
}

.head {
	display: flex;
	align-items: center;
	gap: 11px;
	padding: 11px 13px;
	cursor: pointer;
}
.head:hover { background: var(--hover); }

.who {
	min-width: 0;
	flex: 1;
}
.who strong {
	display: block;
	font-size: 13.5px;
}
.who span {
	display: block;
	font-size: 11.5px;
	color: var(--dim);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

time {
	font-size: 11.5px;
	color: var(--dim);
	white-space: nowrap;
}

.caret {
	color: var(--faint);
	transition: transform 0.15s ease;
}
.is-collapsed .caret { transform: rotate(-90deg); }

.content { padding: 0 14px 14px; }

.attachments {
	display: flex;
	flex-wrap: wrap;
	gap: 7px;
	margin-top: 10px;
}

.attachment {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	padding: 7px 11px;
	border: 1px solid var(--line);
	border-radius: var(--radius-sm);
	background: var(--bg);
	color: var(--text);
	font-size: 12px;
	text-decoration: none;
	max-width: 100%;
}
.attachment:hover { border-color: var(--accent); }
.attachment .name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.attachment .size { color: var(--dim); }

.delivery {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
	margin-top: 12px;
	padding-top: 10px;
	border-top: 1px dashed var(--line);
	font-size: 11.5px;
	color: var(--dim);
}

.state {
	padding: 2px 9px;
	border-radius: 999px;
	font-weight: 600;
	background: var(--hover);
}
.state-delivered,
.state-opened {
	color: var(--success);
	background: color-mix(in srgb, var(--success) 15%, transparent);
}
.state-bounced,
.state-failed,
.state-complained {
	color: var(--danger);
	background: color-mix(in srgb, var(--danger) 15%, transparent);
}
</style>
