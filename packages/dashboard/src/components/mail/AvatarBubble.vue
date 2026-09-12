<template>
	<span class="avatar" :style="{ background: colour, width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` }">
		{{ initials }}
	</span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
	defineProps<{ name?: string; email?: string; size?: number }>(),
	{ size: 30 },
);

const PALETTE = [
	"#2b74e8",
	"#12a150",
	"#d97706",
	"#a45cd6",
	"#e5484d",
	"#0f766e",
	"#d9633b",
	"#5b5bd6",
];

const source = computed(() => props.name?.trim() || props.email || "?");

/** A stable colour per correspondent, so faces stay recognisable in a list. */
const colour = computed(() => {
	let hash = 0;
	const value = (props.email || source.value).toLowerCase();
	for (let i = 0; i < value.length; i++)
		hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
	return PALETTE[hash % PALETTE.length];
});

const initials = computed(() => {
	const value = source.value.replace(/[<>"]/g, "").trim();
	const named = value.includes("@") ? value.split("@")[0] : value;
	const parts = named.split(/[\s._-]+/).filter(Boolean);
	if (parts.length === 0) return "?";
	return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
});
</script>

<style scoped>
.avatar {
	display: inline-grid;
	place-items: center;
	border-radius: 50%;
	color: #fff;
	font-weight: 600;
	letter-spacing: 0.02em;
	flex: 0 0 auto;
	user-select: none;
}
</style>
