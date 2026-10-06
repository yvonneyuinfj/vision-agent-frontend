<script setup lang="ts">
/** 智能检测 · 生命周期卡片分型渲染（对齐 React 版 AssistantPage/cards + ReviewCard + SceneCard）。
 *
 *  一张卡 = 一个组件实例，卡片级局部状态（复核表单 / 报告展开 / 已提交标记）互不干扰。
 *  - scene_card：候选场景「按此送检」+「采集指引」，走 sendRequest 复用会话轨；
 *  - review_card：AI 预判快照 + 缺陷明细 + 就地通过/退回（复用 use-tasks.submitReview）；
 *  - report_card：会话内展开 report.md 全文（MarkdownView）+ 打开报告页；
 *  - task_card / done_card：整卡可点，深链到任务中心对应页签并预选该任务。
 *  后端 payload 与 React 前端同源（同一 /agent/sessions/{id}/stream），字段口径一致。 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import IconSvg from '@/components/IconSvg.vue';
import MarkdownView from '@/components/MarkdownView.vue';
import { sendRequest, openTaskDetail, isTaskRunning, taskFinalStatus, type DetItem } from '@/composables/use-detection';
import { submitReview } from '@/composables/use-tasks';
import { sceneCodeToLabel } from '@/data/scene-map';

const props = defineProps<{ item: DetItem }>();
const router = useRouter();

const p = computed<any>(() => props.item.payload || {});
const type = computed(() => props.item.cardType || '');
const taskId = computed<string>(() => props.item.taskId || p.value.task_id || '');

const GENERIC_TITLES: Record<string, string> = {
  task_card: '检测任务', review_card: '待人工复核', done_card: '检测完成',
  report_card: '检测报告', scene_card: '场景确认', doc_card: '演示文稿',
};
const title = computed(() => (type.value && GENERIC_TITLES[type.value]) || '任务动态');

const GRADE_LABEL: Record<string, string> = {
  pass: '合格', defect: '检出缺陷', review: '待复核', fail: '不合格',
  A: 'A 级', B: 'B 级', C: 'C 级', D: 'D 级',
};
function gradeLabel(g: unknown): string {
  const k = String(g ?? '');
  return GRADE_LABEL[k] || k;
}

function modeLabel(mode: unknown): string {
  return mode === 'agent' ? '智能体' : mode === 'joint' ? '联合' : mode === 'single' ? '单场景' : '流水线';
}

/* ---------- 卡片点击：就地弹详情（完整工作台经弹窗底部深链承接） ---------- */
function goTab(tab: 'list' | 'review' | 'reports') {
  if (!taskId.value) return;
  void router.push({ path: '/tasks', query: { tab, task: taskId.value } });
}
function onCardKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTaskDetail(taskId.value); }
}

/* ---------- 场景确认卡 ---------- */
interface SceneCandidate { scene: string; confidence?: number | null }
const sceneCandidates = computed<SceneCandidate[]>(() =>
  Array.isArray(p.value.candidates) ? p.value.candidates : []);
const sceneReasoning = computed<string>(() =>
  typeof p.value.reasoning === 'string' ? p.value.reasoning : '');
function pickScene(code: string) {
  const zh = sceneCodeToLabel(code);
  void sendRequest(`这张图片属于「${zh}（${code}）」场景，已由用户确认，请直接派发质检任务。`, [], 'auto');
}
function askGuide() {
  void sendRequest('这张图片不属于上述任何场景。请给我图像采集指引，说明如何拍摄 / 准备一张可用于质检的图像。', [], 'auto');
}

/* ---------- 复核卡（就地终裁：通过 / 退回 + 意见，复用 submitReview） ---------- */
const rvVerdict = ref<'approve' | 'return'>('approve');
const rvOpinion = ref('');
const rvBusy = ref(false);
const rvDone = ref(false);
const rvActive = computed(() =>
  type.value === 'review_card' && (p.value.status || 'awaiting_review') === 'awaiting_review' && !rvDone.value);
const rvDefects = computed<any[]>(() => (Array.isArray(p.value.defects) ? p.value.defects : []));
async function submitRv() {
  if (!taskId.value || rvBusy.value) return;
  rvBusy.value = true;
  try {
    await submitReview(taskId.value, rvVerdict.value, rvOpinion.value.trim());
    rvDone.value = true;
    message.success(rvVerdict.value === 'approve' ? '复核通过，已提交后端。' : '已退回，任务保持待复核。', 3);
  } catch (e: any) {
    message.error(`复核提交失败：${e?.message || '未知错误'}`, 4);
  } finally {
    rvBusy.value = false;
  }
}

/* ---------- 报告卡（会话内展开 report.md 全文） ---------- */
const reportUri = computed<string>(() => p.value.report?.uri || p.value.report_uri || '');
const reportLead = computed<string>(() => p.value.report?.analysis_lead || p.value.analysis_lead || '');
const repOpen = ref(false);
const repText = ref<string | null>(null);
const repLoading = ref(false);
async function toggleReport() {
  repOpen.value = !repOpen.value;
  if (repOpen.value && repText.value === null && reportUri.value) {
    repLoading.value = true;
    try {
      const r = await fetch(reportUri.value, { credentials: 'include' });
      repText.value = r.ok ? await r.text() : '';
    } catch {
      repText.value = '';
    } finally {
      repLoading.value = false;
    }
  }
}

/* ---------- 通用兜底卡文本 ---------- */
const genericText = computed<string>(() =>
  p.value.message || p.value.summary || p.value.analysis_lead || p.value.guidance || '');

/* ---------- 任务卡：运行中实时反馈 ----------
 * task_card 落卡后后台可能跑几分钟，而卡片"只推不改"不会自动刷新；
 * 用本地秒表 + 不定长进度条让卡片本身"活"起来，明确传达"系统仍在工作"。 */
const taskRunning = computed(() => type.value === 'task_card' && isTaskRunning(taskId.value));
const taskElapsed = ref(0);
let _taskTimer: ReturnType<typeof setInterval> | undefined;
watch(taskRunning, (run) => {
  if (run) {
    taskElapsed.value = 0;
    if (!_taskTimer) _taskTimer = setInterval(() => { taskElapsed.value += 1; }, 1000);
  } else if (_taskTimer) {
    clearInterval(_taskTimer); _taskTimer = undefined;
  }
}, { immediate: true });
const taskElapsedText = computed(() => {
  const s = taskElapsed.value;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}分${(s % 60).toString().padStart(2, '0')}秒`;
});
onUnmounted(() => { if (_taskTimer) clearInterval(_taskTimer); });

/* ---------- 任务卡：终态落定 ----------
 * 完成/复核/报告卡到达后，isTaskRunning 转 false；反查到终态卡即视为已落定，
 * 进度条停走并转终态样式，避免旧 task_card 永远停在 running 观感。 */
const finalStatus = computed<string | null>(() =>
  type.value === 'task_card' ? taskFinalStatus(taskId.value) : null);
const taskSettled = computed(() => type.value === 'task_card' && !taskRunning.value && !!finalStatus.value);
const navStatus = computed<string>(() => {
  if (type.value === 'done_card') return p.value.status || 'completed';
  if (type.value === 'task_card') {
    return taskRunning.value ? (p.value.status || 'running') : (finalStatus.value || 'completed');
  }
  return p.value.status || '';
});
const settledText = computed<string>(() => {
  switch (finalStatus.value) {
    case 'failed': return '任务执行失败';
    case 'awaiting_review': return '已暂停，待人工复核';
    case 'completed': return '算法已完成';
    default: return '任务已结束';
  }
});

/* 状态徽标中文文案（data-status 仍用英文键供样式匹配） */
const STATUS_LABEL: Record<string, string> = {
  running: '执行中', pending: '排队中', completed: '已完成',
  awaiting_review: '待复核', failed: '执行失败', canceled: '已取消',
};
function statusLabel(s: string): string { return STATUS_LABEL[s] || s; }

/* ---------- 文档生成卡（会话内 generate_ppt 产出） ---------- */
const docStatus = computed<string>(() => p.value.status || 'completed');
const docUri = computed<string>(() => p.value.artifact_uri || '');
const docName = computed<string>(() => p.value.filename || 'presentation.pptx');
const docEngine = computed<string>(() => {
  const e = p.value.engine;
  return e === 'llm' ? 'AI 大纲' : e === 'manual' ? '自定义大纲' : e === 'template' ? '模板大纲' : '';
});
</script>

<template>
  <div class="det-card" :class="'det-card-' + type">
    <!-- ===== 场景确认卡：可交互 ===== -->
    <template v-if="type === 'scene_card'">
      <div class="det-card-head">
        <strong>请确认检测场景</strong>
        <span class="det-card-task">{{ taskId }}</span>
      </div>
      <p v-if="sceneReasoning" class="det-scene-reason">{{ sceneReasoning }}</p>
      <div class="det-scene-list">
        <div v-for="c in sceneCandidates" :key="c.scene" class="det-scene-item">
          <div class="det-scene-main">
            <b>{{ sceneCodeToLabel(c.scene) }}</b>
            <code class="det-scene-code">{{ c.scene }}</code>
            <span v-if="typeof c.confidence === 'number'" class="det-scene-conf">
              <span class="det-scene-conf-bar"><span :style="{ width: Math.round(c.confidence * 100) + '%' }"></span></span>
              {{ Math.round(c.confidence * 100) }}%
            </span>
          </div>
          <button class="det-scene-pick" type="button" @click="pickScene(c.scene)">按此送检</button>
        </div>
      </div>
      <div class="det-scene-foot">
        <button class="det-card-btn" type="button" @click="askGuide">都不是，给我采集指引</button>
        <a class="det-card-link" :href="'/tasks?tab=create'" @click.prevent="router.push({ path: '/tasks', query: { tab: 'create' } })">去任务中心补齐参数 →</a>
      </div>
    </template>

    <!-- ===== 复核卡：就地终裁 ===== -->
    <template v-else-if="type === 'review_card'">
      <div class="det-card-head">
        <strong>终裁复核</strong>
        <span class="det-card-task">{{ taskId }}</span>
      </div>
      <template v-if="rvActive">
        <p class="det-rev-why">
          任务已暂停并进入人工复核门<span v-if="p.grade_level">：AI 预判「{{ gradeLabel(p.grade_level) }}」</span><span v-if="p.defect_count">，检出 {{ p.defect_count }} 项缺陷</span><span v-if="p.grade_summary">。{{ p.grade_summary }}</span>
        </p>
        <div v-if="rvDefects.length" class="det-rev-defects">
          <div v-for="(d, i) in rvDefects" :key="i" class="det-rev-drow">
            <span class="det-rev-did">A{{ i + 1 }}</span>
            <b>{{ d.name || '未命名缺陷' }}</b>
            <span class="det-grow"></span>
            <span v-if="d.severity" class="det-rev-dsev" :data-sev="d.severity">{{ d.severity }}</span>
            <code v-if="typeof d.confidence === 'number'" class="det-rev-dconf">{{ d.confidence.toFixed(2) }}</code>
          </div>
        </div>
        <div class="det-rev-form">
          <div class="det-rev-seg" role="group" aria-label="复核结论">
            <button type="button" :class="{ on: rvVerdict === 'approve' }" @click="rvVerdict = 'approve'">通过</button>
            <button type="button" :class="{ on: rvVerdict === 'return' }" @click="rvVerdict = 'return'">退回</button>
          </div>
          <textarea v-model="rvOpinion" class="det-rev-note" rows="2" placeholder="复核意见（可选）"></textarea>
          <div class="det-rev-actions">
            <button class="det-card-btn" type="button" :disabled="rvBusy" @click="goTab('review')">打开复核工作台 →</button>
            <button class="det-rev-submit" type="button" :disabled="rvBusy" @click="submitRv">{{ rvBusy ? '提交中…' : '提交复核结论' }}</button>
          </div>
        </div>
      </template>
      <div v-else class="det-rev-done">
        <IconSvg name="check" />
        <span>{{ rvDone ? '已提交终裁复核，流水线继续生成报告。' : '该任务已完成终裁复核，无需人工处置。' }}</span>
        <button class="det-card-btn" type="button" @click="openTaskDetail(taskId)">查看任务 →</button>
      </div>
    </template>

    <!-- ===== 报告卡：会话内展开 + 独立报告页 ===== -->
    <template v-else-if="type === 'report_card'">
      <div class="det-card-head">
        <strong>智能质检报告</strong>
        <span class="det-card-task">{{ taskId }}</span>
        <span v-if="p.grade_level" class="det-grade" :data-level="p.grade_level">判级：{{ gradeLabel(p.grade_level) }}</span>
      </div>
      <div class="det-card-meta">
        <span v-if="p.scene">场景 {{ sceneCodeToLabel(p.scene) }}</span>
        <span v-if="typeof p.defect_count === 'number'">检出 {{ p.defect_count }} 项</span>
        <span class="det-report-ready">📄 报告已就绪</span>
      </div>
      <p v-if="reportLead" class="det-card-text">{{ reportLead }}</p>
      <div v-if="reportUri" class="det-report-doc">
        <button class="det-report-doc-h" type="button" @click="toggleReport">
          <span class="det-doc-chev" :class="{ open: repOpen }">▸</span>
          {{ repOpen ? '收起报告内容' : '查看报告' }}
          <code class="det-doc-name">report.md</code>
        </button>
        <div v-show="repOpen" class="det-report-doc-body">
          <p v-if="repLoading" class="det-report-tip">报告内容加载中…</p>
          <p v-else-if="repText === ''" class="det-report-tip">报告内容为空或加载失败。</p>
          <MarkdownView v-else-if="repText" :text="repText" />
        </div>
      </div>
      <button class="det-report-link" type="button" @click="openTaskDetail(taskId)">打开任务详情 →</button>
      <p class="det-card-cta">如需查看缺陷明细或复核标注，随时告诉我。</p>
    </template>

    <!-- ===== 文档生成卡：PPT 下载入口 ===== -->
    <template v-else-if="type === 'doc_card'">
      <div class="det-card-head">
        <strong :class="{ danger: docStatus === 'failed' }">{{ p.title || '演示文稿' }}</strong>
        <span class="det-card-task">{{ taskId }}</span>
        <span class="det-card-status" :data-status="docStatus">{{ docStatus === 'completed' ? '已生成' : docStatus === 'failed' ? '生成失败' : statusLabel(docStatus) }}</span>
      </div>
      <div class="det-card-meta">
        <span v-if="docEngine">{{ docEngine }}</span>
        <span v-if="typeof p.slide_count === 'number'">共 {{ p.slide_count }} 页</span>
        <span>{{ docName }}</span>
      </div>
      <p v-if="docStatus === 'failed'" class="det-done-error">⚠ {{ p.error_message || '演示文稿生成失败' }}</p>
      <a
        v-else-if="docUri"
        class="det-report-link"
        :href="docUri"
        :download="docName"
        target="_blank"
        rel="noopener"
      >⬇ 下载 .pptx</a>
      <p class="det-card-cta">想套用自定义 .pptx 模板或逐页编辑大纲？前往「能力中心 · PPT 制作」（聊天内暂不支持）。</p>
    </template>

    <!-- ===== 任务创建卡 / 完成卡：整卡可点直达任务详情 ===== -->
    <template v-else-if="type === 'task_card' || type === 'done_card'">
      <div
        class="det-navcard"
        :class="{ 'is-running': taskRunning }"
        role="button"
        tabindex="0"
        @click="openTaskDetail(taskId)"
        @keydown="onCardKey"
      >
        <div class="det-card-head">
          <strong :class="{ danger: type === 'done_card' && p.status === 'failed' }">{{ title }}</strong>
          <span class="det-card-task">{{ taskId }}</span>
          <span class="det-card-status" :data-status="navStatus">{{ statusLabel(navStatus) }}</span>
        </div>
        <div class="det-card-meta">
          <span v-if="p.scene">场景 {{ sceneCodeToLabel(p.scene) }}</span>
          <span v-if="p.mode">模式 {{ modeLabel(p.mode) }}</span>
          <span v-if="typeof p.image_count === 'number'">图片 {{ p.image_count }} 张</span>
        </div>
        <!-- 任务卡进度：运行中不定长滑动 + 秒表；落定后停走并转终态 -->
        <div
          v-if="taskRunning || taskSettled"
          class="det-task-running"
          :class="{ settled: taskSettled, 'st-failed': taskSettled && finalStatus === 'failed', 'st-review': taskSettled && finalStatus === 'awaiting_review' }"
        >
          <span class="det-task-bar" aria-hidden="true"><i></i></span>
          <span class="det-task-elapsed">{{ taskRunning ? ('已运行 ' + taskElapsedText + ' · 正在等待算法结果…') : settledText }}</span>
        </div>
        <template v-if="type === 'done_card'">
          <p v-if="p.status === 'failed'" class="det-done-error">⚠ {{ p.error_message || '任务执行失败' }}</p>
          <template v-else>
            <div class="det-card-meta">
              <span v-if="typeof p.defect_count === 'number'">检出 {{ p.defect_count }} 项</span>
              <span v-if="p.grade_level" class="det-grade" :data-level="p.grade_level">综合判级：{{ gradeLabel(p.grade_level) }}</span>
            </div>
            <p v-if="p.grade_summary" class="det-card-text">{{ p.grade_summary }}</p>
            <p class="det-card-cta">如需查看缺陷明细或复核标注，随时告诉我。</p>
          </template>
        </template>
        <p v-else-if="genericText" class="det-card-text">{{ genericText }}</p>
        <div class="det-nav-go">{{ type === 'done_card' ? '查看详情 →' : (taskRunning ? '任务执行中，落定后自动推送完成卡 · 查看详情 →' : (taskSettled ? '任务已落定 · 查看详情 →' : '任务已派发 · 查看详情 →')) }}</div>
      </div>
    </template>

    <!-- ===== 兜底：未知卡型 ===== -->
    <template v-else>
      <div class="det-card-head">
        <strong>{{ title }}</strong>
        <span class="det-card-task">{{ taskId }}</span>
      </div>
      <p v-if="genericText" class="det-card-text">{{ genericText }}</p>
      <div class="det-card-meta">
        <span v-if="p.scene">场景 {{ sceneCodeToLabel(p.scene) }}</span>
        <span v-if="p.status">状态 {{ p.status }}</span>
        <span v-if="p.grade_level">判级 {{ gradeLabel(p.grade_level) }}</span>
        <span v-if="p.defect_count != null">缺陷 {{ p.defect_count }}</span>
      </div>
      <a v-if="reportUri" class="det-card-link" :href="reportUri" target="_blank" rel="noopener">查看报告</a>
    </template>
  </div>
</template>
