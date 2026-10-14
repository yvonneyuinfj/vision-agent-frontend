<script setup lang="ts">
/** 智能检测 · 生命周期卡片分型渲染（对齐 React 版 AssistantPage/cards + ReviewCard + SceneCard）。
 *
 *  一张卡 = 一个组件实例，卡片级局部状态（复核表单 / 报告展开 / 已提交标记）互不干扰。
 *  - scene_card：候选场景「按此送检」+「采集指引」，走 sendRequest 复用会话轨；
 *  - review_card：AI 预判快照 + 缺陷明细 + 就地通过/退回（复用 use-tasks.submitReview）；
 *  - report_card：会话内展开 report.md 全文（MarkdownView）+ 打开报告页；
 *  - task_card：一行派发回执（实时进度由检测页底部任务舱统一呈现）；
 *  - done_card：整卡可点，就地弹任务详情弹窗。
 *  后端 payload 与 React 前端同源（同一 /agent/sessions/{id}/stream），字段口径一致。 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import IconSvg from '@/components/IconSvg.vue';
import MarkdownView from '@/components/MarkdownView.vue';
import GradeStamp from '@/components/GradeStamp.vue';
import { sendRequest, openTaskDetail, isTaskRunning, taskFinalStatus, type DetItem } from '@/composables/use-detection';
import { submitReview } from '@/composables/use-tasks';
import { useTheme } from '@/composables/use-theme';
import { sceneCodeToLabel } from '@/data/scene-map';

const props = defineProps<{ item: DetItem }>();
const router = useRouter();
const theme = useTheme();

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
  const themeQuery = theme.value === 'dark' ? { theme: 'dark' as const } : {};
  // 复核已拆为独立路由页；列表/报告仍走任务中心
  if (tab === 'review') {
    void router.push({ path: '/tasks/review', query: { task: taskId.value, ...themeQuery } });
    return;
  }
  void router.push({ path: '/tasks', query: { tab, task: taskId.value, ...themeQuery } });
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

/* ---------- 复核卡（就地终裁：同意 / 驳回 + 意见，改判与缺陷修订经复核工作台） ---------- */
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
    message.success(
      rvVerdict.value === 'approve'
        ? '已同意判级，流水线继续生成报告。'
        : '已驳回终止：任务落失败终态（不是退回重排队），如需重检请重新提交。', 4);
  } catch (e: any) {
    message.error(`复核提交失败：${e?.message || '未知错误'}`, 4);
  } finally {
    rvBusy.value = false;
  }
}

/* ---------- 报告卡（点击弹出 report.md 全文弹窗） ---------- */
const reportUri = computed<string>(() => p.value.report?.uri || p.value.report_uri || '');
const reportLead = computed<string>(() => p.value.report?.analysis_lead || p.value.analysis_lead || '');
const repOpen = ref(false);
const repText = ref<string | null>(null);
const repLoading = ref(false);
async function openReport() {
  repOpen.value = true;
  if (repText.value === null && reportUri.value) {
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
function closeReport() { repOpen.value = false; }
/** 弹窗内跳任务详情：先关本弹窗，避免与全局详情弹窗叠加。 */
function goTaskDetail() { repOpen.value = false; openTaskDetail(taskId.value); }

/* ---------- 通用兜底卡文本 ---------- */
const genericText = computed<string>(() =>
  p.value.message || p.value.summary || p.value.analysis_lead || p.value.guidance || '');

/* ---------- 任务派发回执：只陈述事实，不承载实时态 ----------
 * task_card 由 SSE 在工具执行期间推下，必然落在助手本回合文字的中间。
 * 若在此处放进度条 + 秒表，用户会读成"卡在这一步了"，还会与线程底部的运行反馈抢注意力。
 * 故回执行只说"已派发 / 已落定"，实时秒表统一交给 DetectionView 底部的任务舱——
 * 聊天流承载历史事实，实时态落在最新位置。 */
const taskRunning = computed(() => type.value === 'task_card' && isTaskRunning(taskId.value));

/* ---------- 任务卡：终态落定 ----------
 * 完成/复核/报告卡到达后 isTaskRunning 转 false；反查到终态卡即染色，
 * 避免旧回执行永远停在"执行中"观感。 */
const finalStatus = computed<string | null>(() =>
  type.value === 'task_card' ? taskFinalStatus(taskId.value) : null);
const taskSettled = computed(() => type.value === 'task_card' && !taskRunning.value && !!finalStatus.value);
/** 完成卡（navcard）状态徽标。 */
const navStatus = computed<string>(() => p.value.status || '');
const settledText = computed<string>(() => {
  switch (finalStatus.value) {
    case 'failed': return '任务执行失败';
    case 'awaiting_review': return '已暂停，待人工复核';
    case 'completed': return '算法已完成';
    default: return '任务已结束';
  }
});
/** 回执行文案：运行中不带任何时间信息，进度归任务舱。 */
const receiptText = computed<string>(() => {
  if (taskRunning.value) return '检测任务执行中';
  if (taskSettled.value) return settledText.value;
  return '任务已派发';
});
/** 回执行色调（左竖条 + 圆点），供 CSS 类名切换。 */
const receiptTone = computed<string>(() => {
  if (taskRunning.value) return 'running';
  switch (finalStatus.value) {
    case 'failed': return 'failed';
    case 'awaiting_review': return 'review';
    case 'completed': return 'done';
    default: return 'pending';
  }
});

/* 状态徽标中文文案（data-status 仍用英文键供样式匹配） */
const STATUS_LABEL: Record<string, string> = {
  running: '执行中', pending: '排队中', completed: '已完成',
  awaiting_review: '待复核', failed: '执行失败', canceled: '已取消',
};
function statusLabel(s: string): string { return STATUS_LABEL[s] || s; }

/* 完成卡头部是否已盖判级印章（有印章时隐去状态徽标，避免与“已完成”重复） */
const headStamped = computed<boolean>(() => !!p.value.grade_level && p.value.status !== 'failed');

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
        <GradeStamp v-if="p.grade_level && rvActive" :level="p.grade_level" size="sm" subtitle="AI 预判 · 自动判级引擎" />
      </div>
      <template v-if="rvActive">
        <p class="det-rev-why">
          任务已暂停并进入人工复核门<span v-if="p.defect_count">，检出 {{ p.defect_count }} 项缺陷</span><span v-if="p.grade_summary">。{{ p.grade_summary }}</span>
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
            <button type="button" :class="{ on: rvVerdict === 'approve' }" @click="rvVerdict = 'approve'">同意判级</button>
            <button type="button" :class="{ on: rvVerdict === 'return' }" @click="rvVerdict = 'return'">驳回终止</button>
          </div>
          <textarea v-model="rvOpinion" class="det-rev-note" rows="2" placeholder="复核意见（可选）"></textarea>
          <div class="det-rev-actions">
            <button class="det-card-btn" type="button" @click="goTab('review')">改判 / 核图去工作台 →</button>
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
        <GradeStamp v-if="p.grade_level" :level="p.grade_level" size="sm" />
      </div>
      <div class="det-card-meta">
        <span v-if="p.scene">场景 {{ sceneCodeToLabel(p.scene) }}</span>
        <span v-if="typeof p.defect_count === 'number'">检出 {{ p.defect_count }} 项</span>
        <span class="det-report-ready">📄 报告已就绪</span>
      </div>
      <p v-if="reportLead" class="det-card-text">{{ reportLead }}</p>
      <div v-if="reportUri" class="det-report-doc">
        <button class="det-report-doc-h" type="button" @click="openReport">
          <span class="det-doc-chev">↗</span>
          查看报告
          <code class="det-doc-name">report.md</code>
        </button>
      </div>
      <Teleport to="body">
        <div v-if="repOpen" class="det-modal" @click.self="closeReport">
          <div class="det-modal-panel" role="dialog" aria-modal="true" aria-label="智能质检报告">
            <header class="det-modal-head">
              <div class="det-modal-title">
                <span class="det-modal-eyebrow">智能质检报告</span>
                <code class="det-modal-id">{{ taskId }}</code>
              </div>
              <span class="det-grow"></span>
              <button class="det-modal-x" type="button" aria-label="关闭" @click="closeReport">×</button>
            </header>
            <div class="det-modal-body">
              <p v-if="repLoading" class="det-modal-note"><span class="det-modal-spin"></span>报告内容加载中…</p>
              <p v-else-if="repText === ''" class="det-modal-note">报告内容为空或加载失败。</p>
              <MarkdownView v-else-if="repText" :text="repText" doc />
            </div>
            <footer class="det-modal-foot">
              <span class="det-modal-foot-hint">完整报告与缺陷明细可在任务中心查看</span>
              <button class="det-modal-cta" type="button" @click="goTaskDetail">打开任务详情</button>
            </footer>
          </div>
        </div>
      </Teleport>
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

    <!-- ===== 任务派发回执：一行事实（实时进度见线程底部任务舱） ===== -->
    <template v-else-if="type === 'task_card'">
      <div
        class="det-task-receipt"
        :class="'st-' + receiptTone"
        :title="genericText"
        role="button"
        tabindex="0"
        @click="openTaskDetail(taskId)"
        @keydown="onCardKey"
      >
        <span class="det-receipt-dot" aria-hidden="true"></span>
        <strong class="det-receipt-label">{{ receiptText }}</strong>
        <span class="det-card-task">{{ taskId }}</span>
        <span class="det-receipt-meta">
          <span v-if="p.scene">{{ sceneCodeToLabel(p.scene) }}</span>
          <span v-if="p.mode">{{ modeLabel(p.mode) }}</span>
          <span v-if="typeof p.image_count === 'number'">{{ p.image_count }} 张图</span>
        </span>
        <span class="det-grow"></span>
        <span class="det-receipt-go">查看详情 →</span>
      </div>
    </template>

    <!-- ===== 完成卡：整卡可点直达任务详情 ===== -->
    <template v-else-if="type === 'done_card'">
      <div
        class="det-navcard"
        role="button"
        tabindex="0"
        @click="openTaskDetail(taskId)"
        @keydown="onCardKey"
      >
        <div class="det-card-head">
          <strong :class="{ danger: p.status === 'failed' }">{{ title }}</strong>
          <span class="det-card-task">{{ taskId }}</span>
          <span v-if="!headStamped" class="det-card-status" :data-status="navStatus">{{ statusLabel(navStatus) }}</span>
          <GradeStamp v-if="headStamped" :level="p.grade_level" size="sm" />
        </div>
        <div class="det-card-meta">
          <span v-if="p.scene">场景 {{ sceneCodeToLabel(p.scene) }}</span>
          <span v-if="p.mode">模式 {{ modeLabel(p.mode) }}</span>
          <span v-if="typeof p.image_count === 'number'">图片 {{ p.image_count }} 张</span>
        </div>
        <p v-if="p.status === 'failed'" class="det-done-error">⚠ {{ p.error_message || '任务执行失败' }}</p>
        <template v-else>
          <div class="det-card-meta">
            <span v-if="typeof p.defect_count === 'number'">检出 {{ p.defect_count }} 项</span>
          </div>
          <p v-if="p.grade_summary" class="det-card-text">{{ p.grade_summary }}</p>
          <p class="det-card-cta">如需查看缺陷明细或复核标注，随时告诉我。</p>
        </template>
        <div class="det-nav-go">查看详情 →</div>
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
