<script setup lang="ts">
/** 任务详情弹窗：智能检测卡片点击就地查看，不跳出本页。
 *  数据源 GET /tasks/{id}（复用 use-tasks.ensureDetail 缓存），只读呈现概览 / 判级 /
 *  输入图像 / 检出缺陷 / 执行轨迹 / 报告；完整操作经底部「在任务中心打开」深链承接。 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import IconSvg from '@/components/IconSvg.vue';
import MarkdownView from '@/components/MarkdownView.vue';
import GradeStamp from '@/components/GradeStamp.vue';
import StageStepper from '@/components/StageStepper.vue';
import { detailModalOpen, detailModalTaskId, closeTaskDetail, stageProgressOf } from '@/composables/use-detection';
import { STAGE_COUNT, nodeLabel } from '@/data/inspection-stages';
import { ensureDetail, taskDetailOf, tasksLive } from '@/composables/use-tasks';
import { useTheme } from '@/composables/use-theme';
import { openImagePreview, previewOpen } from '@/composables/use-image-preview';
import { fileNameFromUri } from '@/api/tasks';

const router = useRouter();

const taskId = computed(() => detailModalTaskId.value);
const detail = computed(() => (taskId.value ? taskDetailOf(taskId.value) : undefined));
watch(taskId, (id) => { if (id) void ensureDetail(id); });

const STATUS_LABEL: Record<string, string> = {
  pending: '排队中', running: '检测中', awaiting_review: '待复核',
  completed: '已完成', failed: '失败', canceled: '已取消',
};
const statusLabel = (s: string) => STATUS_LABEL[s] || s;
const SEV_LABEL: Record<string, string> = { low: '轻微', medium: '中等', high: '严重' };

function confPct(d: any): number | null {
  return typeof d.confidence === 'number' ? Math.round(d.confidence * 100) : null;
}
function locText(d: any): string {
  const box = d.location?.bbox ?? d.location?.bbox_xyxy;
  if (box && box.length >= 4) return `${Math.round(box[0])}, ${Math.round(box[1])}`;
  return d.image_name || d.description || '—';
}

const images = computed(() => {
  const d = detail.value;
  if (!d) return [] as { src: string; name: string }[];
  // 直接用后端返回的业务 URI：输入图存于伪 task_id（_upload/_studio），重拼真实任务号会 404。
  return (d.input_uris || []).map((uri) => ({ src: uri, name: fileNameFromUri(uri) }));
});
const defects = computed<any[]>(() => (detail.value?.standardized || []).filter((x) => !x.human_rejected));
const report = computed(() => detail.value?.report || null);

/* ---------- 流程阶段：与检测页任务舱同一推导口径（共用 store.details 快照） ---------- */
const progress = computed(() => (taskId.value ? stageProgressOf(taskId.value) : null));

function fmtTs(ts: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString('zh-CN', { hour12: false });
}

/** 执行轨迹：只留流程骨架。思考链行的 message 是整段 JSON，工具逐次留痕会刷屏，
 *  两者从列表里拿掉，工具调用折叠成一行计数（细节看会话里的思考链）。 */
const traceSteps = computed<Array<{ node: string; label: string; message: string; ts: string }>>(() =>
  (detail.value?.steps || [])
    .filter((s) => s.node !== 'chain' && !String(s.node).startsWith('tool:'))
    .map((s) => ({
      node: s.node,
      label: nodeLabel(String(s.node)),
      message: String(s.message || ''),
      ts: fmtTs(String(s.ts || '')),
    })));
const toolCallCount = computed(() =>
  (detail.value?.steps || []).filter((s) => String(s.node).startsWith('tool:')).length);

/* 裂图占位：记录加载失败的缩略图索引 */
const imgFailed = ref<Set<number>>(new Set());
function onImgErr(i: number) { imgFailed.value = new Set(imgFailed.value).add(i); }
watch(detail, () => { imgFailed.value = new Set(); });

/* 报告全文就地展开（懒拉取 + 缓存，切换任务重置） */
const repOpen = ref(false);
const repText = ref<string | null>(null);
const repLoading = ref(false);
watch(detail, () => { repOpen.value = false; repText.value = null; });
async function toggleReport() {
  repOpen.value = !repOpen.value;
  const uri = report.value?.uri;
  if (repOpen.value && repText.value === null && uri) {
    repLoading.value = true;
    try {
      const r = await fetch(uri, { credentials: 'include' });
      repText.value = r.ok ? await r.text() : '';
    } catch { repText.value = ''; }
    finally { repLoading.value = false; }
  }
}

function openInTaskCenter() {
  if (!taskId.value) return;
  const themeQuery = useTheme().value === 'dark' ? { theme: 'dark' as const } : {};
  // 待复核 → 复核工作台（独立路由）；其余 → 任务中心列表
  if (detail.value?.status === 'awaiting_review') {
    void router.push({ path: '/tasks/review', query: { task: taskId.value, ...themeQuery } });
  } else {
    void router.push({ path: '/tasks', query: { task: taskId.value, ...themeQuery } });
  }
  closeTaskDetail();
}

const ctaLabel = computed(() => (detail.value?.status === 'awaiting_review' ? '前往复核工作台 →' : '在任务中心打开 →'));
const footHint = computed(() =>
  (detail.value?.status === 'awaiting_review' ? '待复核任务需人工终裁，报告才会生成' : '完整列表筛选与报告归档请前往任务中心'));

function onKey(e: KeyboardEvent) {
  // 灯箱在顶层时，Esc 交给灯箱处理，不关本弹窗
  if (e.key === 'Escape' && detailModalOpen.value && !previewOpen.value) closeTaskDetail();
}
document.addEventListener('keydown', onKey);
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="detailModalOpen" class="det-modal" @click.self="closeTaskDetail">
    <div class="det-modal-panel" role="dialog" aria-modal="true" aria-label="任务详情">
      <!-- 头部 -->
      <header class="det-modal-head">
        <div class="det-modal-title">
          <span class="det-modal-eyebrow">任务详情</span>
          <code class="det-modal-id">{{ taskId }}</code>
        </div>
        <span v-if="detail" class="det-modal-status" :data-status="detail.status">{{ statusLabel(detail.status) }}</span>
        <span class="det-grow"></span>
        <button class="det-modal-x" type="button" aria-label="关闭" @click="closeTaskDetail">×</button>
      </header>

      <div class="det-modal-body">
        <p v-if="!tasksLive" class="det-modal-note">当前为本地演示模式，无真实任务详情可加载。</p>
        <p v-else-if="detail === undefined" class="det-modal-note"><span class="det-modal-spin"></span>任务详情加载中…</p>
        <p v-else-if="detail === null" class="det-modal-note">任务详情读取失败，请稍后重试或在任务中心打开。</p>

        <template v-else-if="detail">
          <!-- 检测流程：六段式阶段总览（轮询任务执行痕迹推导，弹窗打开期间同步刷新） -->
          <section v-if="progress" class="det-mdl-sec">
            <h4>检测流程 <span class="det-mdl-count">{{ progress.current + 1 }}/{{ STAGE_COUNT }}</span></h4>
            <StageStepper :progress="progress" />
          </section>

          <!-- 判级 / 错误 -->
          <div v-if="detail.error" class="det-mdl-callout is-error">
            <span class="det-mdl-callout-hd">执行失败 · {{ nodeLabel(detail.error.node) }}</span>
            <p>{{ detail.error.message }}</p>
          </div>
          <div v-else-if="detail.grade" class="det-mdl-grade">
            <p class="det-mdl-grade-sum">{{ detail.grade.summary || '暂无判级摘要' }}</p>
            <GradeStamp :level="detail.grade.level" />
          </div>

          <!-- 输入图像 -->
          <section v-if="images.length" class="det-mdl-sec">
            <h4>输入图像 <span class="det-mdl-count">{{ images.length }}</span></h4>
            <div class="det-mdl-imgs">
              <div
                v-for="(im, i) in images" :key="i"
                class="det-mdl-thumb" :class="{ 'is-broken': imgFailed.has(i) }" :title="im.name"
                role="button" tabindex="0" @click="openImagePreview(images, i)" @keydown.enter="openImagePreview(images, i)"
              >
                <img :src="im.src" :alt="im.name" loading="lazy" @error="onImgErr(i)" />
                <span v-if="imgFailed.has(i)" class="det-mdl-thumb-ph">图片不可用</span>
                <template v-else>
                  <span class="det-mdl-thumb-zoom"><IconSvg name="inspect" /></span>
                  <a class="det-mdl-thumb-dl" :href="im.src" :download="im.name" title="下载原图" @click.stop><IconSvg name="download" /></a>
                </template>
              </div>
            </div>
          </section>

          <!-- 检出缺陷 -->
          <section class="det-mdl-sec">
            <h4>检出缺陷 <span class="det-mdl-count">{{ defects.length }}</span></h4>
            <p v-if="!defects.length" class="det-mdl-empty">无检出项</p>
            <div v-else class="det-mdl-tablewrap">
              <table class="det-mdl-table">
                <thead><tr><th>识别项</th><th>置信度</th><th>严重度</th><th>位置</th></tr></thead>
                <tbody>
                  <tr v-for="(d, i) in defects" :key="i">
                    <td>{{ d.defect_name_cn || d.defect_type || '未命名缺陷' }}</td>
                    <td>
                      <span v-if="confPct(d) != null" class="det-mdl-bar"><i :style="{ width: confPct(d) + '%' }"></i></span>
                      <span class="det-mdl-conf">{{ confPct(d) != null ? confPct(d) + '%' : '—' }}</span>
                    </td>
                    <td><span class="det-mdl-sev" :data-sev="d.severity || 'none'">{{ d.severity ? SEV_LABEL[d.severity] || d.severity : '—' }}</span></td>
                    <td class="det-mdl-loc">{{ locText(d) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- 执行轨迹 -->
          <section v-if="traceSteps.length" class="det-mdl-sec">
            <h4>
              执行轨迹 <span class="det-mdl-count">{{ traceSteps.length }}</span>
              <span v-if="toolCallCount" class="det-mdl-sub">含 {{ toolCallCount }} 次工具调用</span>
            </h4>
            <ol class="det-mdl-steps">
              <li v-for="(s, i) in traceSteps" :key="i">
                <span class="det-mdl-node">{{ s.label }}</span>
                <span class="det-mdl-msg">{{ s.message }}</span>
                <span v-if="s.ts" class="det-mdl-ts">{{ s.ts }}</span>
              </li>
            </ol>
          </section>

          <!-- 报告 -->
          <section v-if="report" class="det-mdl-sec">
            <h4>检测报告</h4>
            <div class="det-report-doc">
              <button class="det-report-doc-h" type="button" @click="toggleReport">
                <IconSvg name="report" />
                <span>{{ report.name || 'report.md' }}</span>
                <span class="det-doc-chev" :class="{ open: repOpen }">▸</span>
                <a v-if="report.uri" class="det-mdl-dl" :href="report.uri" target="_blank" rel="noopener" @click.stop>下载</a>
              </button>
              <div v-show="repOpen" class="det-report-doc-body">
                <p v-if="repLoading" class="det-report-tip">报告内容加载中…</p>
                <p v-else-if="repText === ''" class="det-report-tip">报告内容为空或加载失败。</p>
                <MarkdownView v-else-if="repText" :text="repText" doc />
              </div>
            </div>
          </section>
        </template>
      </div>

      <footer class="det-modal-foot">
        <span class="det-modal-foot-hint">{{ footHint }}</span>
        <button class="det-modal-cta" type="button" @click="openInTaskCenter">{{ ctaLabel }}</button>
      </footer>
    </div>
  </div>
</template>
