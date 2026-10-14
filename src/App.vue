<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { theme as antdTheme } from 'ant-design-vue';
import { useTheme } from '@/composables/use-theme';
import AppHeader from '@/components/AppHeader.vue';
import ImageLightbox from '@/components/ImageLightbox.vue';

const route = useRoute();
const theme = useTheme();
const isLogin = computed(() => route.path === '/login');

const antTheme = computed(() =>
  theme.value === 'dark' ? { algorithm: antdTheme.darkAlgorithm } : { algorithm: antdTheme.defaultAlgorithm },
);

watch(
  () => route.path,
  (path) => {
    const inTasks = path === '/tasks' || path.startsWith('/tasks/');
    document.body.classList.toggle('center-page', path === '/capabilities' || path === '/detection' || inTasks || path === '/knowledge' || path === '/tools' || path === '/admin' || path.startsWith('/report'));
    document.body.classList.toggle('detection-page', path === '/detection');
    document.body.classList.toggle('task-page', inTasks);
    document.body.classList.toggle('knowledge-page', path === '/knowledge');
    document.body.classList.toggle('report-page', path.startsWith('/report'));
  },
  { immediate: true },
);
</script>

<template>
  <a-config-provider :theme="antTheme">
    <AppHeader v-if="!isLogin" />
    <router-view />
    <ImageLightbox />
  </a-config-provider>
</template>
