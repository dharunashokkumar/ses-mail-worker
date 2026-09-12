<template>
	<iframe
		ref="frame"
		class="body-frame"
		:style="{ height: `${height}px` }"
		sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
		title="Message"
		@load="render"
	/>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Attachment } from "@/types/mail";

const props = defineProps<{
	body: string;
	attachments: Attachment[];
	mailboxId: string;
	messageId: string;
}>();

const frame = ref<HTMLIFrameElement | null>(null);
const height = ref(120);
let observer: ResizeObserver | null = null;

/** Inline images arrive as cid: references; point them at the attachment route. */
function resolveInlineImages(html: string): string {
	return html.replace(/src=(["'])cid:([^"']+)\1/gi, (match, quote, cid) => {
		const attachment = props.attachments.find(
			(item) => (item.content_id ?? "").replace(/^<|>$/g, "") === cid,
		);
		if (!attachment) return match;
		const url = `/api/v1/mailboxes/${encodeURIComponent(props.mailboxId)}/emails/${encodeURIComponent(
			props.messageId,
		)}/attachments/${encodeURIComponent(attachment.id)}`;
		return `src=${quote}${url}${quote}`;
	});
}

function themeVariables(): { text: string; link: string; quote: string } {
	const styles = getComputedStyle(document.documentElement);
	return {
		text: styles.getPropertyValue("--text").trim() || "#1d1d1f",
		link: styles.getPropertyValue("--accent").trim() || "#2b74e8",
		quote: styles.getPropertyValue("--line").trim() || "#e7e7ee",
	};
}

function render() {
	const element = frame.value;
	const doc = element?.contentDocument;
	if (!element || !doc) return;

	const theme = themeVariables();
	const content = props.body?.trim()
		? resolveInlineImages(props.body)
		: "<p><em>This message has no content.</em></p>";

	doc.open();
	doc.write(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    color: ${theme.text};
    background: transparent;
    font: 14px/1.62 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    word-break: break-word;
  }
  a { color: ${theme.link}; }
  img, video { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; }
  blockquote {
    margin: 0 0 0 10px;
    padding-left: 12px;
    border-left: 2px solid ${theme.quote};
    opacity: .8;
  }
</style></head><body>${content}</body></html>`);
	doc.close();

	measure();
	observer?.disconnect();
	if ("ResizeObserver" in window && doc.body) {
		observer = new ResizeObserver(() => measure());
		observer.observe(doc.body);
	}
}

function measure() {
	const doc = frame.value?.contentDocument;
	if (!doc?.body) return;
	height.value = Math.max(60, doc.body.scrollHeight + 8);
}

watch(() => [props.body, props.messageId], render);

// The iframe's own load event can fire before Vue binds the handler.
onMounted(render);

onBeforeUnmount(() => observer?.disconnect());
</script>

<style scoped>
.body-frame {
	width: 100%;
	border: 0;
	display: block;
	background: transparent;
}
</style>
