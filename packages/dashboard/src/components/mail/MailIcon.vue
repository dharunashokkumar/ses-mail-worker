<template>
	<svg
		class="glyph"
		:style="{ width: `${size}px`, height: `${size}px` }"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.7"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		v-html="path"
	/>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{ name: string; size?: number }>(), {
	size: 16,
});

/** One place for every glyph in the app, so weights and corners stay consistent. */
const PATHS: Record<string, string> = {
	inbox:
		'<path d="M3 13h4.5l1.8 3h5.4l1.8-3H21"/><path d="M5.6 5h12.8l2.6 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4z"/>',
	clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
	draft:
		'<path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13 3v6h6"/>',
	send: '<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-8-8-4z"/>',
	archive:
		'<rect x="3" y="4" width="18" height="4.5" rx="1.4"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5"/><path d="M10 12.5h4"/>',
	spam: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>',
	trash:
		'<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
	tag: '<path d="M3.5 11.2V4.5a1 1 0 0 1 1-1h6.7L20.5 12.8 12.8 20.5z"/><circle cx="8" cy="8" r="1.3"/>',
	star: '<path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z"/>',
	pin: '<path d="M15 3l6 6-3 1-4.5 4.5L13 19l-2 2-8-8 2-2 4.5-.5L14 6z"/>',
	clip: '<path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8L9.8 17.3a1.8 1.8 0 0 1-2.5-2.5l7.7-7.7"/>',
	search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
	gear: '<circle cx="12" cy="12" r="3.1"/><path d="M4.6 14.5a1.6 1.6 0 0 0-1.4-1H3v-3h.2a1.6 1.6 0 0 0 1.4-1 1.6 1.6 0 0 0-.3-1.8l1.9-2.3a1.6 1.6 0 0 0 1.9.3 1.6 1.6 0 0 0 1-1.5V3h3v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.9-.3l2.3 1.9a1.6 1.6 0 0 0-.3 1.9 1.6 1.6 0 0 0 1.5 1H21v3h-.2a1.6 1.6 0 0 0-1.5 1 1.6 1.6 0 0 0 .3 1.9l-1.9 2.3a1.6 1.6 0 0 0-1.9-.3 1.6 1.6 0 0 0-1 1.5V21h-3v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.9.3l-2.3-1.9a1.6 1.6 0 0 0 .3-1.9z"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	pen: '<path d="M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16z"/><path d="M14.5 5.5 18.5 9.5"/>',
	reply: '<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/>',
	"reply-all":
		'<path d="M8 7 3 12l5 5"/><path d="M13 7 8 12l5 5"/><path d="M8 12h8a5 5 0 0 1 5 5v1"/>',
	forward: '<path d="m15 7 5 5-5 5"/><path d="M20 12H11a6 6 0 0 0-6 6v1"/>',
	close: '<path d="M6 6l12 12M18 6 6 18"/>',
	chevron: '<path d="m6 9 6 6 6-6"/>',
	"chevron-right": '<path d="m9 6 6 6-6 6"/>',
	menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
	ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.2 15.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
	check: '<path d="m5 13 4 4 10-10"/>',
	back: '<path d="M15 5l-7 7 7 7"/>',
	bell: '<path d="M18 16V11a6 6 0 1 0-12 0v5l-2 3h16z"/><path d="M10 21h4"/>',
	folder:
		'<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/>',
	mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.6 7 8.4 6 8.4-6"/>',
	"mail-open":
		'<path d="M3 10.5 12 4l9 6.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m3 10.5 9 6 9-6"/>',
	box: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17"/>',
	shield:
		'<path d="M12 3l7.5 3v5.5c0 4.6-3 8-7.5 9.5-4.5-1.5-7.5-4.9-7.5-9.5V6z"/>',
	download:
		'<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
	offline:
		'<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 13a10 10 0 0 1 4-2.4"/><path d="M15 10.6A10 10 0 0 1 19 13"/><path d="M2 9.5A15 15 0 0 1 7 6.3"/><path d="M17 6.3a15 15 0 0 1 5 3.2"/>',
	filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
	refresh: '<path d="M20 11.5a8 8 0 1 1-2.6-5.4"/><path d="M20 4v5h-5"/>',
	link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.3-1.3"/>',
	list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
	quote:
		'<path d="M9 7.5c-2.5 1-4 3-4 5.5v3.5h4.5V12H7c0-1.6.7-2.9 2-3.6z"/><path d="M18 7.5c-2.5 1-4 3-4 5.5v3.5h4.5V12H16c0-1.6.7-2.9 2-3.6z"/>',
};

const path = computed(() => PATHS[props.name] ?? "");
</script>

<style scoped>
.glyph {
	flex: 0 0 auto;
	display: block;
}
</style>
