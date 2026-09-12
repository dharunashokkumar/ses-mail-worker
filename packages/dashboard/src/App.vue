<template>
	<router-view />
	<Toast />
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import Toast from "@/components/Toast.vue";
import { useAppSettings } from "@/composables/useAppSettings";
import { usePrefsStore } from "@/stores/prefs";

const { fetchSettings } = useAppSettings();
const prefs = usePrefsStore();

onMounted(() => {
	// Theme and density come from storage before anything else paints.
	prefs.apply();
	fetchSettings();
});
</script>
