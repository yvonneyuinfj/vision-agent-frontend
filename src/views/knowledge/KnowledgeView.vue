<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import IconSvg from '@/components/IconSvg.vue';
import { setTheme, useTheme, activeNav } from '@/composables/use-theme';
import { activeTab } from '@/composables/use-knowledge';
import KnowledgeSearchView from './KnowledgeSearchView.vue';
import KnowledgeIngestView from './KnowledgeIngestView.vue';
import KnowledgeCollectView from './KnowledgeCollectView.vue';

const route = useRoute();
const theme = useTheme();
const dark = computed(() => theme.value === 'dark');

/* 主题:进入页面按 URL 同步;深蓝样式注入/卸载统一由 setTheme 处理 */
setTheme(route.query.theme === 'dark' ? 'dark' : 'light');
onMounted(() => { activeNav.value = '知识中心'; });

const homeQuery = computed(() => (dark.value ? { theme: 'dark' as const } : {}));
</script>

<template>
  <div class="kb-wrap">
    <div class="kb-topline">
      <nav class="breadcrumbs" aria-label="面包屑">
        <RouterLink :to="{ path: '/', query: homeQuery }">首页</RouterLink>
        <span>/</span><strong>知识中心</strong>
      </nav>
    </div>

    <div class="kb-heading">
      <div class="kb-heading-left">
        <h1>知识中心</h1>
        <span>专业知识与可信依据 · 检索 · 引用 · 溯源</span>
      </div>
      <span class="kb-demo-tag"></span>
    </div>

    <a-tabs v-model:activeKey="activeTab" class="kb-tabs">
      <a-tab-pane key="ingest" tab="资料入库"><KnowledgeIngestView /></a-tab-pane>
      <a-tab-pane key="search" tab="检索与引用"><KnowledgeSearchView /></a-tab-pane>
      <a-tab-pane key="collect" tab="内网采集任务"><KnowledgeCollectView /></a-tab-pane>
    </a-tabs>
  </div>
</template>
