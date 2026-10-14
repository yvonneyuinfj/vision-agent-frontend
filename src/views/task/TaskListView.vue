<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import IconSvg from '@/components/IconSvg.vue';
import { capabilities } from '@/data';
import { fetchDocument } from '@/api/tasks';
import { sortedTasks, taskStats, loading, error, refreshTasks, tasksLive, timeKey, openDocumentDetail, reviewableTasks } from '@/composables/use-tasks';
import { openTaskDetail } from '@/composables/use-detection';
import { useTheme } from '@/composables/use-theme';
import { statusMeta, type TaskStatus, type DetectionTask } from '@/data/tasks';

const router = useRouter();
const theme = useTheme();
/** 跨页跳转保留当前主题（深蓝主题靠 ?theme=dark 同步） */
const themeQuery = computed(() => (theme.value === 'dark' ? { theme: 'dark' as const } : {}));
const statusFilter = ref<TaskStatus | 'all'>('all');
const kindFilter = ref<'all' | 'inspection' | 'document'>('all');
const sceneFilter = ref('all');
const keyword = ref('');

onMounted(() => { if (!sortedTasks.value.length) void refreshTasks(); });

/* ---------- KPI 卡片 ---------- */
const kpiCards = computed(() => {
  const s = taskStats.value;
  return [
    { label: '任务总数', value: s.total, note: '当前筛选范围', icon: 'clipboard', color: '#2368e4', bg: '#edf4ff' },
    { label: '进行中', value: s.running, note: '检测任务执行中', icon: 'play', color: '#2368e4', bg: '#edf4ff' },
    { label: '待复核', value: s.awaiting, note: '等待人工确认', icon: 'clock', color: '#e6a23c', bg: '#fdf6ec' },
    { label: '已完成', value: s.completed, note: '复核与报告已归档', icon: 'check', color: '#22a06b', bg: '#e8f8ef' },
    { label: '失败 / 取消', value: s.failed, note: s.failed > 0 ? `失败 ${s.failed}` : '无异常', icon: 'alert', color: '#e04f4f', bg: '#fdecec' },
  ];
});

/* ---------- 过滤状态 tabs ---------- */
const filterTabs = computed(() => {
  const s = taskStats.value;
  return [
    { key: 'all' as const, label: '全部', count: s.total },
    { key: 'running' as const, label: '进行中', count: s.running },
    { key: 'pending' as const, label: '待复核', count: s.awaiting },
    { key: 'done' as const, label: '已完成', count: s.completed },
    { key: 'failed' as const, label: '异常', count: s.failed },
  ];
});

/* ---------- 场景选项（过滤掉文档任务的空场景） ---------- */
const scenes = computed(() => Array.from(new Set(sortedTasks.value.map((t) => t.scene))).filter(Boolean));
const sceneOptions = computed(() => [
  { value: 'all', label: '全部' },
  ...scenes.value.map((s) => ({ value: s, label: s })),
]);

/* ---------- 过滤行 ---------- */
const rows = computed(() =>
  sortedTasks.value.filter((t) =>
    (statusFilter.value === 'all' || t.status === statusFilter.value ||
      (statusFilter.value === 'pending' && t.status === 'reviewing')) &&
    (kindFilter.value === 'all' || (kindFilter.value === 'document' ? t.kind === 'document' : t.kind !== 'document')) &&
    (sceneFilter.value === 'all' || t.scene === sceneFilter.value) &&
    (!keyword.value.trim() || (t.id + t.object + t.scene).toLowerCase().includes(keyword.value.trim().toLowerCase()))));

/* ---------- 排序 ---------- */
type SortKey = 'object' | 'scene' | 'imageCount' | 'status' | 'createdAt';
const sortKey = ref<SortKey>('createdAt');
const sortDir = ref<'asc' | 'desc'>('desc');
const statusRank: Record<TaskStatus, number> = { running: 0, pending: 1, reviewing: 2, done: 3, failed: 4 };
function toggleSort(k: SortKey) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  else { sortKey.value = k; sortDir.value = k === 'createdAt' ? 'desc' : 'asc'; }
  currentPage.value = 1;
}
function sortIcon(k: SortKey): string {
  if (sortKey.value !== k) return '↕';
  return sortDir.value === 'asc' ? '▲' : '▼';
}
function sortVal(t: DetectionTask): number | string {
  switch (sortKey.value) {
    case 'object': return `${t.object} ${t.id}`.toLowerCase();
    case 'scene': return t.scene;
    case 'imageCount': return t.imageCount ?? -1;
    case 'status': return statusRank[t.status] ?? 99;
    case 'createdAt': return timeKey(t.createdAt);
  }
}
const sortedRows = computed(() => {
  const dir = sortDir.value === 'asc' ? 1 : -1;
  return [...rows.value].sort((a, b) => {
    const av = sortVal(a), bv = sortVal(b);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
});

/* ---------- 分页 ---------- */
const currentPage = ref(1);
const pageSize = ref(8);
const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return sortedRows.value.slice(start, start + pageSize.value);
});
const totalPages = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value)));

/* ---------- 能力图标查找 ---------- */
function capMeta(capId: string) {
  return capabilities.find((c) => c.id === capId) ?? { icon: 'box', color: '#64748b', bg: '#f0f2f5', name: '' };
}

/* ---------- 状态对应操作（检测：已完成→报告页，待复核→复核工作台；文档：已完成→下载 PPT；其余→任务详情弹窗） ---------- */
function actionLabel(status: TaskStatus, kind?: string): string {
  if (kind === 'document') return status === 'done' ? '下载 PPT' : '查看详情';
  if (status === 'done') return '查看报告';
  if (status === 'running') return '查看进度';
  if (status === 'failed') return '查看原因';
  return '去复核'; // pending / reviewing
}
function actionColor(status: TaskStatus, kind?: string): string {
  if (status === 'done') return kind === 'document' ? '#7c5cff' : '#2368e4';
  switch (status) {
    case 'pending': case 'reviewing': return '#e6a23c';
    case 'running': return '#2368e4';
    case 'failed': return '#e04f4f';
    default: return '#2368e4';
  }
}
/** 复核工作台深链：带 task 参数由工作台预选队列中的该任务 */
function goReview(taskId: string) {
  void router.push({ path: '/tasks/review', query: { task: taskId, ...themeQuery.value } });
}
async function downloadDocument(id: string) {
  try {
    const d = await fetchDocument(id);
    if (d.artifact_uri) window.open(d.artifact_uri, '_blank');
    else message.warning(d.error || 'PPT 尚未生成完成，请稍后再试');
  } catch (e: any) {
    message.error(e?.message || 'PPT 下载失败');
  }
}
function primaryAction(id: string, status: TaskStatus, kind?: string, title = '') {
  if (kind === 'document') {
    if (status === 'done') void downloadDocument(id);
    else openDocumentDetail(id, title);
    return;
  }
  if (status === 'done') { void router.push({ path: `/report/${encodeURIComponent(id)}` }); return; }
  if (status === 'pending' || status === 'reviewing') { goReview(id); return; }
  openTaskDetail(id);
}
/* 行内「详情」：文档任务走 PPT 专属弹窗，检测任务走通用详情 */
function openDetailRow(t: DetectionTask) {
  if (t.kind === 'document') openDocumentDetail(t.id, t.object);
  else openTaskDetail(t.id);
}
/* ---------- 状态行说明（真实口径；文档任务用生成/下载语义） ---------- */
function statusNote(status: TaskStatus, kind?: string): string {
  if (kind === 'document') {
    switch (status) {
      case 'running': return 'PPT 生成中';
      case 'done': return '已生成 · 可下载';
      case 'failed': return '生成失败';
      default: return '';
    }
  }
  switch (status) {
    case 'running': return '检测执行中';
    case 'pending': case 'reviewing': return '等待人工复核';
    case 'done': return '报告已归档';
    case 'failed': return '任务执行失败';
    default: return '';
  }
}
/* ---------- 状态标签文案（文档任务用生成语义） ---------- */
function statusTagLabel(t: DetectionTask): string {
  if (t.kind === 'document') {
    switch (t.status) {
      case 'running': return '生成中';
      case 'done': return '已完成';
      case 'failed': return '失败';
      default: return statusMeta[t.status].label;
    }
  }
  return statusMeta[t.status].label;
}
</script>

<template>
  <div class="task-panel">
    <!-- KPI 卡片 -->
    <div class="task-kpi-row">
      <div v-for="k in kpiCards" :key="k.label" class="task-kpi-card" :style="{ '--kpi-accent': k.color, '--kpi-tint': k.bg }">
        <span class="task-kpi-icon">
          <IconSvg :name="k.icon" />
        </span>
        <div class="task-kpi-body">
          <span class="task-kpi-label">{{ k.label }}</span>
          <strong class="task-kpi-value">{{ k.value }}</strong>
          <span class="task-kpi-note">{{ k.note }}</span>
        </div>
      </div>
    </div>

    <p v-if="error" class="task-error-bar">⚠ {{ error }}</p>

    <!-- 待复核提醒：命中复核门的任务可一键进入复核工作台 -->
    <div v-if="reviewableTasks.length" class="task-review-cta">
      <IconSvg name="shield" />
      <div class="task-review-cta-text">
        <strong>{{ reviewableTasks.length }} 个任务等待人工终裁</strong>
        <span>高风险 / 低置信度结论已在复核门暂停，不复核不会生成报告。</span>
      </div>
      <button class="task-action-btn primary" type="button" @click="goReview(reviewableTasks[0].id)">
        <span>＋</span>进入复核工作台
      </button>
    </div>

    <!-- 列表标题 + 过滤 -->
    <div class="task-list-header">
      <h2 class="task-list-title">任务列表</h2>
      <div class="task-filter-tabs">
        <button
          v-for="ft in filterTabs"
          :key="ft.key"
          class="task-filter-tab"
          :class="{ active: statusFilter === ft.key }"
          type="button"
          @click="statusFilter = ft.key; currentPage = 1"
        >{{ ft.label }}&nbsp;&nbsp;{{ ft.count }}</button>
      </div>
      <div class="task-filter-right">
        <div class="task-search-box">
          <IconSvg name="inspect" />
          <input v-model="keyword" type="text" placeholder="搜索任务名称 / 编号 / 业务对象" @input="currentPage = 1" />
        </div>
        <select v-model="kindFilter" class="task-select" @change="currentPage = 1">
          <option value="all">任务类型: 全部</option>
          <option value="inspection">任务类型: 检测任务</option>
          <option value="document">任务类型: 文档任务</option>
        </select>
        <select v-model="sceneFilter" class="task-select" @change="currentPage = 1">
          <option v-for="o in sceneOptions" :key="o.value" :value="o.value">检测方向: {{ o.label }}</option>
        </select>
      </div>
    </div>

    <!-- 数据表格 -->
    <div class="task-table-wrap">
      <table class="task-data-table">
        <thead>
          <tr>
            <th class="th-sortable" :class="{ sorted: sortKey === 'object' }" @click="toggleSort('object')">任务名称 / 编号<span class="th-sort-ico">{{ sortIcon('object') }}</span></th>
            <th class="td-center th-sortable" :class="{ sorted: sortKey === 'scene' }" @click="toggleSort('scene')">检测方向<span class="th-sort-ico">{{ sortIcon('scene') }}</span></th>
            <th class="td-center th-sortable" :class="{ sorted: sortKey === 'imageCount' }" @click="toggleSort('imageCount')">图像数量<span class="th-sort-ico">{{ sortIcon('imageCount') }}</span></th>
            <th class="td-center th-sortable" :class="{ sorted: sortKey === 'status' }" @click="toggleSort('status')">当前阶段 / 状态<span class="th-sort-ico">{{ sortIcon('status') }}</span></th>
            <th class="td-center th-sortable" :class="{ sorted: sortKey === 'createdAt' }" @click="toggleSort('createdAt')">创建时间<span class="th-sort-ico">{{ sortIcon('createdAt') }}</span></th>
            <th class="td-center">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in pagedRows" :key="t.id">
            <td class="td-name">
              <strong>{{ t.object }}</strong>
              <small>{{ t.id }}</small>
            </td>
            <td class="td-center">
              <div v-if="t.kind === 'document'" class="td-direction">
                <span class="td-dir-icon" style="background:#f0ebff;color:#7c5cff"><IconSvg name="book" /></span>
                PPT · 文档
              </div>
              <div v-else class="td-direction">
                <span class="td-dir-icon" :style="{ background: capMeta(t.capabilityId).bg, color: capMeta(t.capabilityId).color }">
                  <IconSvg :name="capMeta(t.capabilityId).icon" />
                </span>
                {{ t.scene }}
              </div>
            </td>
            <td class="td-images td-center">
              <IconSvg name="box" class="td-img-icon" />
              {{ t.imageCount != null ? t.imageCount + ' 张' : '—' }}
            </td>
            <td class="td-center">
              <div class="td-status">
                <span class="task-tag" :class="`tone-${statusMeta[t.status].tone}`">{{ statusTagLabel(t) }}</span>
                <span class="td-status-note">{{ statusNote(t.status, t.kind) }}</span>
              </div>
            </td>
            <td class="td-time td-center">{{ t.createdAt }}</td>
            <td class="td-center">
              <div class="td-actions">
                <button
                  class="td-action-btn"
                  :style="{ background: actionColor(t.status, t.kind) }"
                  type="button"
                  @click="primaryAction(t.id, t.status, t.kind, t.object)"
                >{{ actionLabel(t.status, t.kind) }}</button>
                <button class="td-detail-link" type="button" @click="openDetailRow(t)">详情</button>
              </div>
            </td>
          </tr>
          <tr v-if="!pagedRows.length">
            <td colspan="6" class="td-empty">暂无任务数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页 -->
    <div class="task-pagination">
      <span class="task-page-info">显示 {{ (currentPage - 1) * pageSize + 1 }}-{{ Math.min(currentPage * pageSize, rows.length) }} 条，共 {{ rows.length }} 条</span>
      <div class="task-page-controls">
        <select v-model.number="pageSize" class="task-select task-page-size" @change="currentPage = 1">
          <option :value="8">每页 8 条</option>
          <option :value="15">每页 15 条</option>
          <option :value="30">每页 30 条</option>
        </select>
        <button class="task-page-btn" :disabled="currentPage <= 1" type="button" @click="currentPage--">&lt;</button>
        <button
          v-for="p in totalPages"
          :key="p"
          class="task-page-btn"
          :class="{ active: currentPage === p }"
          type="button"
          @click="currentPage = p"
        >{{ p }}</button>
        <button class="task-page-btn" :disabled="currentPage >= totalPages" type="button" @click="currentPage++">&gt;</button>
      </div>
    </div>

    <!-- 底部说明 -->
    <!-- <p class="task-footer-note">
      <IconSvg name="inspect" />
      任务状态区分检测执行、人工复核与报告归档。
    </p> -->
  </div>
</template>
