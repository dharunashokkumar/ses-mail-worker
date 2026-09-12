<template>
	<div class="drop" ref="root">
		<slot name="trigger" :toggle="toggle" :open="open" />
		<Transition name="fade">
			<div v-if="open" class="menu" :style="style" role="menu">
				<slot :close="close" />
			</div>
		</Transition>
	</div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

withDefaults(defineProps<{ style?: Record<string, string> }>(), {
	style: () => ({ top: "calc(100% + 6px)", left: "0" }),
});

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function toggle() {
	open.value = !open.value;
}

function close() {
	open.value = false;
}

function onDocumentPointer(event: PointerEvent) {
	if (!open.value) return;
	if (root.value && !root.value.contains(event.target as Node)) close();
}

function onKey(event: KeyboardEvent) {
	if (event.key === "Escape" && open.value) {
		event.stopPropagation();
		close();
	}
}

onMounted(() => {
	document.addEventListener("pointerdown", onDocumentPointer);
	document.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
	document.removeEventListener("pointerdown", onDocumentPointer);
	document.removeEventListener("keydown", onKey);
});

defineExpose({ close, open });
</script>

<style scoped>
.drop {
	position: relative;
	display: inline-flex;
}
</style>
