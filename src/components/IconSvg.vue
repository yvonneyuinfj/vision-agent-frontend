<script setup lang="ts">
import { computed } from 'vue';
import { iconPath, getCustomIcon } from '@/data';

const props = defineProps<{ name: string }>();

/** 特殊矢量图标(用户提供整图,非 24 线性体系):优先命中 */
const custom = computed(() => getCustomIcon(props.name));
/** 常规线性图标内部路径为本地可信常量(来自 src/data/icon-paths.ts) */
const pathHtml = computed(() => custom.value ? custom.value.html : iconPath(props.name));
</script>

<template>
  <svg
    :viewBox="custom ? custom.viewBox : '0 0 24 24'"
    :class="{ 'icon-filled': custom?.filled }"
    aria-hidden="true"
    v-html="pathHtml"
  />
</template>
