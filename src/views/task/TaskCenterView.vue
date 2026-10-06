<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import IconSvg from '@/components/IconSvg.vue';
import TaskDetailModal from '@/components/TaskDetailModal.vue';
import DocumentDetailModal from '@/components/DocumentDetailModal.vue';
import { setTheme, useTheme, activeNav } from '@/composables/use-theme';
import { activeTab, refreshTasks, tasksLive, loading, setFocusTask } from '@/composables/use-tasks';
import type { TaskTab } from '@/composables/use-tasks';
import TaskListView from './TaskListView.vue';

const route = useRoute();
const router = useRouter();
const theme = useTheme();
const dark = computed(() => theme.value === 'dark');

setTheme(route.query.theme === 'dark' ? 'dark' : 'light');
// 本轮仅开放任务列表；新建任务改为跳转智能检测对话框（本页新建表单暂隐藏）。
const VALID_TABS: TaskTab[] = ['list'];
onMounted(() => {
  activeNav.value = '任务中心';
  // 深链：智能检测卡片跳转携带 ?tab=&task=，预选任务后落到列表
  const qtask = route.query.task;
  if (typeof qtask === 'string' && qtask) setFocusTask(qtask);
  if (!VALID_TABS.includes(activeTab.value)) activeTab.value = 'list';
  void refreshTasks();
});

const homeQuery = computed(() => (dark.value ? { theme: 'dark' as const } : {}));

/* 新建任务 → 跳转智能检测对话框（复用深蓝主题） */
function goDetection() {
  void router.push({ path: '/detection', query: homeQuery.value });
}

const tabs: { key: TaskTab; label: string }[] = [
  { key: 'list', label: '任务列表' },
];
</script>

<template>
  <div class="task-wrap">
    <!-- 标题 + 右上角操作区 -->
    <div class="task-heading">
      <div class="task-heading-left">
        <h1>任务中心</h1>
        <p class="task-subtitle">检测执行、结果复核与报告归档，统一跟踪任务进展。</p>
        <!-- <span class="task-demo-tag">{{ tasksLive ? '真实数据' : '示例数据' }}</span> -->
      </div>
      
      <div class="task-top-actions">
        <span class="task-status-badge" :class="{ online: tasksLive }">
          <i></i>{{ tasksLive ? '后端已连接' : '本地演示' }}
        </span>
        <!-- <button class="task-action-btn" type="button" :disabled="loading" @click="refreshTasks">
          <IconSvg name="refresh" /><span>刷新</span>
        </button> -->
        <button class="task-action-btn primary" type="button" @click="goDetection">
          <span>+</span>新建任务
        </button>
      </div>
    </div>
    
    <!-- 自定义 Tabs（仅剩一个页签时隐藏切换栏） -->
    <div v-if="tabs.length > 1" class="task-tabs-bar">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="task-tab-item"
        :class="{ active: activeTab === t.key }"
        type="button"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- Tab 内容 -->
    <div class="task-tab-content">
      <TaskListView />
    </div>

    <!-- 任务详情弹窗（行内“详情/查看进度”就地查看） -->
    <TaskDetailModal />
    <!-- 文档（PPT）任务专属详情弹窗 -->
    <DocumentDetailModal />
  </div>
</template>
