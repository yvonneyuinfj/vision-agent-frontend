<script setup lang="ts">
/** 复核工作台（/tasks/review）：待复核队列 + 图像缺陷联动修订 + 复核决定，一屏完成人工终裁。
 *  视图只做装配：会话状态与后端契约全部在 composables/use-review.ts。 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import IconSvg from '@/components/IconSvg.vue';
import ReviewImageStage from '@/components/ReviewImageStage.vue';
import ReviewDefectTable from '@/components/ReviewDefectTable.vue';
import ReviewDecisionPanel from '@/components/ReviewDecisionPanel.vue';
import ReviewScenePanel from '@/components/ReviewScenePanel.vue';
import { setTheme, useTheme, activeNav } from '@/composables/use-theme';
import { refreshTasks, tasksLive, timeKey, setFocusTask } from '@/composables/use-tasks';
import {
  action, activeDefectId, addBox, advanceQueue, artifacts, awaiting, classDefs, decided, demoMode,
  detailError, draftDefects, editSummary, error as rvError, finalStatus, gateQuestion, grade,
  hasEdits, imageIndex, inputImages, interrupt, isSceneConfirm, moveDefect, opinion, overrideLevel,
  patchDefect, phase, phaseText, pickScene, primeFromFocus, queue, removeDefect, resetDraft,
  retryDetail, sceneCandidates, selectDefect, selectTask, selectedId, selectedTask, setTool,
  setImageIndex, submitting, submitDecision, tool, toggleReject, untypedCount,
  type ReviewActionKey,
} from '@/composables/use-review';

const route = useRoute();
const router = useRouter();
const theme = useTheme();
const dark = computed(() => theme.value === 'dark');
setTheme(route.query.theme === 'dark' ? 'dark' : 'light');

const refreshing = ref(false);
onMounted(() => {
  activeNav.value = '任务中心';
  // 深链 ?task= 交给 use-tasks 的 focusTask，由 primeFromFocus 命中队列后定位
  const qtask = route.query.task;
  if (typeof qtask === 'string' && qtask) setFocusTask(qtask);
  void reload();
});

/** 队列与当前详情一起刷新：受理即返回的复核需要重取才能看到终态。 */
async function reload() {
  refreshing.value = true;
  try {
    await refreshTasks();
    primeFromFocus();
  } finally {
    refreshing.value = false;
  }
}

const homeQuery = computed(() => (dark.value ? { theme: 'dark' as const } : {}));
function backToTasks() {
  void router.push({ path: '/tasks', query: homeQuery.value });
}
function viewReport() {
  if (!selectedId.value) return;
  void router.push({ path: `/report/${encodeURIComponent(selectedId.value)}`, query: homeQuery.value });
}

/** 同路由换 task 参数（组件不重挂）：就地重新定位会话。 */
watch(() => route.query.task, (v) => {
  if (typeof v !== 'string' || !v) return;
  setFocusTask(v);
  primeFromFocus();
});

const queueSorted = computed(() => [...queue.value].sort((a, b) => timeKey(b.createdAt) - timeKey(a.createdAt)));
const hasNext = computed(() => queue.value.some((t) => t.id !== selectedId.value));
const taskTitle = computed(() => selectedTask.value?.object || selectedId.value || '未选择任务');
const canDraw = computed(() => inputImages.value.length > 0);
/** 后端 decision_options 原文是动作码（含未开放的 requeue），这里译成中文并标注可用性 */
const ACTION_CN: Record<string, string> = {
  confirm: '同意判级', revise: '改判 / 修正', reject: '驳回终止',
  requeue: '重新检测（后端未开放）', auto_confirm: '自动通过',
};
const gateOptions = computed<string[]>(() =>
  (interrupt.value?.decision_options ?? []).map((o) => ACTION_CN[String(o)] || String(o)));
/** 队列里已复核留痕（本地演示或详情已落库的人工决定） */
const decidedOf = (id: string) => (id === selectedId.value ? decided.value : undefined);

/** 队列切换 = 开一次新的复核会话（use-review 内部会重置草稿并重取详情）。 */
function pickTask(id: string) {
  selectTask(id);
}

/* 决定表单回写：统一走函数（store 导出的 computed 不能直接 v-model 赋值） */
function onAction(v: ReviewActionKey | '') { action.value = v; }
function onOpinion(v: string) { opinion.value = v; }
function onOverrideLevel(v: string) { overrideLevel.value = v; }

async function onSubmit() {
  // 不自动前进：落定后由面板给出「查看报告 / 处理下一个」，避免丢掉受理结果反馈
  await submitDecision();
}
</script>

<template>
  <div class="task-wrap rvw">
    <!-- 顶栏：返回 + 标题 + 队列概览 -->
    <div class="task-heading rvw-head">
      <div class="task-heading-left">
        <button class="rvw-back" type="button" @click="backToTasks"><span>←</span>任务中心</button>
        <h1>复核工作台</h1>
        <p class="task-subtitle">逐条确认检测结论：看图核框、修订缺陷、给出终裁，提交后流水线继续生成报告。</p>
      </div>
      <div class="task-top-actions">
        <span class="task-status-badge" :class="{ online: tasksLive }">
          <i></i>{{ tasksLive ? '后端已连接' : '本地演示' }}
        </span>
        <span class="rvw-queue-badge"><IconSvg name="clock" />待复核 {{ queue.length }}</span>
        <button class="task-action-btn" type="button" :disabled="refreshing" @click="reload">
          <IconSvg name="scan" /><span>{{ refreshing ? '刷新中…' : '刷新' }}</span>
        </button>
      </div>
    </div>

    <p v-if="demoMode" class="task-error-bar">⚠ 本地演示模式：可演练复核流程，结论与缺陷修订不会写入后端。</p>
    <p v-if="detailError" class="task-error-bar">⚠ {{ detailError }}
      <button class="rvw-btn tiny" type="button" @click="retryDetail">重试</button>
    </p>

    <!-- 队列为空且无进行中会话才空档；提交后队列可能空掉，但要保留落定反馈与「查看报告」 -->
    <div v-if="!queue.length && !selectedId" class="rvw-blank">
      <IconSvg name="check" />
      <h2>暂无待复核任务</h2>
      <p>检测任务跑到复核门时会出现在这里；也可在任务列表查看进行中与已完成任务。</p>
      <button class="task-action-btn primary" type="button" @click="backToTasks">返回任务列表</button>
    </div>

    <div v-else class="rvw-grid">
      <!-- 左：待复核队列 -->
      <aside class="rvw-queue">
        <h4 class="rvw-col-title">复核队列</h4>
        <p v-if="!queue.length" class="rvw-hint muted">当前无其他待复核任务。</p>
        <ul>
          <li
            v-for="t in queueSorted"
            :key="t.id"
            class="rvw-queue-item"
            :class="{ on: t.id === selectedId }"
            @click="pickTask(t.id)"
          >
            <div class="rvw-queue-main">
              <strong>{{ t.object }}</strong>
              <small>{{ t.id }}</small>
            </div>
            <span v-if="decidedOf(t.id)" class="rvw-tag ok">已处理</span>
            <span v-else class="task-tag tone-amber">待复核</span>
            <small class="rvw-queue-time">{{ t.createdAt }}</small>
          </li>
        </ul>
      </aside>

      <!-- 中：图像 + 缺陷修订 -->
      <section class="rvw-main">
        <div class="rvw-gate">
          <span class="rvw-gate-ico"><IconSvg name="alert" /></span>
          <div>
            <strong>{{ taskTitle }}</strong>
            <p>{{ gateQuestion }}</p>
          </div>
          <span v-if="gateOptions.length" class="rvw-gate-opts">
            可选动作：{{ gateOptions.join(' / ') }}
          </span>
        </div>

        <ReviewImageStage
          :images="inputImages"
          :index="imageIndex"
          :defects="draftDefects"
          :active-id="activeDefectId"
          :artifacts="artifacts"
          :tool="tool"
          :readonly="!awaiting"
          @update:index="setImageIndex"
          @select="selectDefect"
          @add-box="addBox"
          @move-box="moveDefect($event.id, $event.bbox)"
        />

        <div class="rvw-defects-bar">
          <span class="rvw-hint muted">
            共 {{ draftDefects.length }} 条；点行或点图上框可联动定位
            <template v-if="hasEdits">；当前修订：{{ editSummary }}</template>
          </span>
          <span class="rvw-grow"></span>
          <button v-if="hasEdits && awaiting" class="rvw-btn tiny" type="button" @click="resetDraft">放弃修订</button>
        </div>

        <ReviewDefectTable
          :rows="draftDefects"
          :active-id="activeDefectId"
          :class-defs="classDefs"
          :tool="tool"
          :readonly="!awaiting"
          :can-draw="canDraw"
          @select="selectDefect"
          @patch="patchDefect"
          @toggle-reject="toggleReject"
          @remove="removeDefect"
          @set-tool="setTool"
        />
      </section>

      <!-- 右：决定 / 场景确认 -->
      <aside class="rvw-side">
        <ReviewScenePanel
          v-if="isSceneConfirm"
          :question="gateQuestion"
          :candidates="sceneCandidates"
          :opinion="opinion"
          :awaiting="awaiting"
          :submitting="submitting"
          :phase="phase"
          :phase-text="phaseText"
          :error="rvError"
          :decided-note="decided?.note || ''"
          @update:opinion="onOpinion"
          @pick="pickScene"
        />
        <ReviewDecisionPanel
          v-else
          :action="action"
          :opinion="opinion"
          :override-level="overrideLevel"
          :grade="grade"
          :has-edits="hasEdits"
          :edit-summary="editSummary"
          :untyped="untypedCount"
          :has-next="hasNext"
          :awaiting="awaiting"
          :decided="decided"
          :phase="phase"
          :phase-text="phaseText"
          :error="rvError"
          :final-status="finalStatus"
          :submitting="submitting"
          @update:action="onAction"
          @update:opinion="onOpinion"
          @update:override-level="onOverrideLevel"
          @submit="onSubmit"
          @advance="advanceQueue"
          @view-report="viewReport"
        />
      </aside>
    </div>
  </div>
</template>
