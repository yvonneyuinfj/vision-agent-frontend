<script setup lang="ts">
/** 独立智能质检报告页（/report/:taskId）。
 *  数据全部来自现有只读接口：结构化 QaTaskDetail（ensureDetail / taskDetailOf）+
 *  报告正文 GET /reports/{task_id}。按截图复刻判级印章、任务元信息、图像对比、
 *  缺陷卡片、类别定义表、知识库引用与 AI 综合分析；支持下载 .md 与打印 / 存为 PDF。 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MarkdownView from '@/components/MarkdownView.vue';
import { fetchReport, type QaReportBody } from '@/api/tasks';
import { ensureDetail, taskDetailOf, tasksLive } from '@/composables/use-tasks';
import { sceneCodeToLabel } from '@/data/scene-map';
import { openImagePreview, type PreviewImage } from '@/composables/use-image-preview';

const route = useRoute();
const router = useRouter();
const taskId = String(route.params.taskId || '');

const loading = ref(true);
const report = ref<QaReportBody | null>(null);
const reportError = ref('');

const detail = computed(() => taskDetailOf(taskId));

/* ---------- 时间 / 判级 / 模式 展示辅助 ---------- */
function pad(n: number): string { return String(n).padStart(2, '0'); }
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDuration(created: string | null | undefined, finished: string | null | undefined): string {
  if (!created || !finished) return '—';
  const ms = Date.parse(finished) - Date.parse(created);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  return `${m} 分 ${pad(s % 60)} 秒`;
}

const GRADE_LABEL: Record<string, string> = {
  pass: '合 格', defect: '检出缺陷', review: '待复 核', fail: '不合格',
  A: 'A 级', B: 'B 级', C: 'C 级', D: 'D 级',
};
const gradeLevel = computed<string>(() => String(detail.value?.grade?.level ?? ''));
const gradeLabel = computed<string>(() => {
  const k = gradeLevel.value;
  return GRADE_LABEL[k] || (k ? k.toUpperCase() : '待判定');
});

function modeLabel(mode: unknown): string {
  return mode === 'agent' ? 'ReAct 智能体' : mode === 'joint' ? '联合综合研判' : mode === 'single' ? '单场景检测' : '流水线';
}

/* ---------- 图像对比（原图 / 标注图） ---------- */
interface RptImage { src: string; name: string; annotated: boolean }
const images = computed<RptImage[]>(() => {
  const d = detail.value;
  if (!d) return [];
  const arts = d.report?.artifacts || [];
  const orig = arts.find((a) => /original/i.test(a.name))?.uri || d.input_uris?.[0] || '';
  const annotated = arts.find((a) => /result|annotat|defect/i.test(a.name))?.uri || '';
  const list: RptImage[] = [];
  if (orig) list.push({ src: orig, name: '原始图像 · ORIGINAL', annotated: false });
  if (annotated) list.push({ src: annotated, name: '模型标注 · ANNOTATED', annotated: true });
  return list;
});
const originalImg = computed(() => images.value.find((x) => !x.annotated) || null);
const annotatedImg = computed(() => images.value.find((x) => x.annotated) || null);
const previewList = computed<PreviewImage[]>(() =>
  images.value.map((x) => ({ src: x.src, name: x.name })));
function openImg(src: string) {
  const idx = images.value.findIndex((x) => x.src === src);
  if (previewList.value.length) openImagePreview(previewList.value, idx < 0 ? 0 : idx);
}

/* ---------- 缺陷卡片 ---------- */
interface RptDefect { name: string; type: string; confidence: number | null; description: string }
const defects = computed<RptDefect[]>(() =>
  (detail.value?.standardized || [])
    .filter((x) => !x.human_rejected)
    .map((x) => ({
      name: x.defect_name_cn || x.defect_type || '未命名缺陷',
      type: x.defect_type || '',
      confidence: typeof x.confidence === 'number' ? x.confidence : null,
      description: x.description || '',
    })));

/* ---------- 类别定义表 ---------- */
interface RptClassRow { code: string; name: string; desc: string; isDefect: boolean; detected: number }
const classRows = computed<RptClassRow[]>(() => {
  const d = detail.value;
  if (!d) return [];
  const std = d.standardized || [];
  const defs = (d.class_definitions || []) as Array<Record<string, any>>;
  if (defs.length) {
    return defs.map((c) => {
      const code = String(c.class_id ?? c.code ?? '');
      return {
        code,
        name: String(c.class_name ?? c.name ?? code),
        desc: String(c.description ?? ''),
        isDefect: c.is_true_defect !== false,
        detected: std.filter((s) => !s.human_rejected && s.defect_type === code).length,
      };
    });
  }
  // 退化：按 standardized 出现的 defect_type 聚合
  const map = new Map<string, RptClassRow>();
  for (const s of std) {
    if (s.human_rejected) continue;
    const code = s.defect_type || '未分类';
    const cur = map.get(code);
    if (cur) cur.detected += 1;
    else map.set(code, { code, name: s.defect_name_cn || code, desc: '', isDefect: true, detected: 1 });
  }
  return Array.from(map.values());
});

/* ---------- 知识库引用 ---------- */
const citations = computed(() => detail.value?.knowledge || []);
function fmtScore(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : '—';
}

/* ---------- 元信息 ---------- */
const imageCount = computed(() => {
  const d = detail.value;
  return d?.input_uris?.length || (d?.report?.artifacts?.length ?? 0) || images.value.length;
});
const metaRows = computed(() => {
  const d = detail.value;
  return [
    { k: '任务编号', v: taskId || '—' },
    { k: '检测场景', v: sceneCodeToLabel(d?.scene) },
    { k: '执行模式', v: modeLabel(d?.mode) },
    { k: '视觉能力', v: d?.capability_used || '—' },
    { k: '提交时间', v: fmtDateTime(d?.created_at) },
    { k: '检测用时', v: fmtDuration(d?.created_at, d?.finished_at) },
    { k: '参与图像', v: `${imageCount.value} 幅` },
    { k: '报告生成', v: fmtDateTime(report.value?.meta?.generated_at) },
  ];
});

/* ---------- 操作 ---------- */
function back() {
  void router.push({ path: '/tasks', query: { tab: 'reports', task: taskId } });
}
function downloadMd() {
  const content = report.value?.content || '';
  if (!content) return;
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report-${taskId}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function printReport() { window.print(); }

/* ---------- 取数 ---------- */
onMounted(async () => {
  if (!tasksLive.value || !taskId) { loading.value = false; return; }
  try {
    const [_, body] = await Promise.all([
      ensureDetail(taskId),
      fetchReport(taskId).catch((e: any) => { reportError.value = e?.message || '报告读取失败'; return null; }),
    ]);
    report.value = body;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="rpt-wrap">
    <!-- 工具条 -->
    <div class="rpt-toolbar">
      <div class="rpt-tool-left">
        <button class="rpt-back" type="button" @click="back">← 返回任务详情</button>
        <span class="rpt-tool-task">报告编号 <code>{{ taskId }}</code></span>
      </div>
      <div class="rpt-tool-right">
        <button class="rpt-btn" type="button" :disabled="!report?.content" @click="downloadMd">
          <svg class="rpt-btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          下载 .md
        </button>
        <button class="rpt-btn primary" type="button" @click="printReport">
          <svg class="rpt-btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
          </svg>
          打印 / 存为 PDF
        </button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="rpt-state">
      <div class="rpt-skel">
        <div class="rpt-skel-bar" style="width:40%"></div>
        <div class="rpt-skel-bar" style="width:100%"></div>
        <div class="rpt-skel-bar" style="width:92%"></div>
        <div class="rpt-skel-bar" style="width:70%"></div>
      </div>
    </div>

    <!-- 演示模式占位 -->
    <div v-else-if="!tasksLive" class="rpt-state">
      <h2>本地演示模式</h2>
      <p>当前未连接 quality-agent 后端，独立报告页需要真实任务数据。请从「任务中心 · 报告清单」查看已完成任务的真实报告。</p>
    </div>

    <!-- 详情读取失败 -->
    <div v-else-if="detail === null" class="rpt-state">
      <h2>报告数据读取失败</h2>
      <p>未能获取该任务的详情数据，任务可能已被清理或无权访问。</p>
      <div class="rpt-tool-right" style="justify-content:center;margin-top:18px">
        <button class="rpt-btn" type="button" @click="back">返回报告清单</button>
      </div>
    </div>

    <!-- 详情尚未就绪 -->
    <div v-else-if="!detail" class="rpt-state">
      <p>正在准备报告数据…</p>
    </div>

    <!-- 报告纸 -->
    <article v-else class="rpt-sheet">
      <header class="rpt-head">
        <div>
          <p class="rpt-eyebrow">AEROQC · 无损检测智能质检</p>
          <h1 class="rpt-title">智能质检报告</h1>
          <p class="rpt-sub">本报告由智能质检 Agent 依据推理产物与 RAGFlow 知识库自动生成，判级结论供人工复核参考。</p>
        </div>
        <div class="rpt-stamp" :data-level="gradeLevel || 'review'">
          <span class="rpt-stamp-level">{{ gradeLabel }}</span>
          <span class="rpt-stamp-sub">综合判级 · 自动判级引擎</span>
        </div>
      </header>

      <!-- 元信息 -->
      <div class="rpt-meta">
        <div v-for="m in metaRows" :key="m.k" class="rpt-meta-item">
          <span class="rpt-meta-k">{{ m.k }}</span>
          <span class="rpt-meta-v">{{ m.v }}</span>
        </div>
      </div>

      <!-- 一、检测概述 -->
      <section class="rpt-sec">
        <h2 class="rpt-sec-h">一、检测概述 <span class="en">OVERVIEW</span></h2>
        <p class="rpt-lead">
          本任务对「<b>{{ sceneCodeToLabel(detail.scene) }}</b>」场景执行自动质检，共 <b>{{ imageCount }}</b> 幅图像参与推理，
          由「<b>{{ modeLabel(detail.mode) }}</b>」模式驱动视觉能力「<b>{{ detail.capability_used || '检测模型' }}</b>」完成缺陷识别与判级。
        </p>
        <div v-if="images.length" class="rpt-imgs" :class="{ single: images.length === 1 }">
          <div v-for="im in images" :key="im.src" class="rpt-img-cell">
            <div class="rpt-img-cap" :class="{ annotated: im.annotated }">
              <span>{{ im.name }}</span>
              <span>点击放大</span>
            </div>
            <div class="rpt-img-wrap" role="button" tabindex="0" @click="openImg(im.src)" @keydown.enter="openImg(im.src)">
              <img class="rpt-img" :src="im.src" :alt="im.name" loading="lazy" />
            </div>
          </div>
        </div>
        <p v-else class="rpt-empty">该任务未提供可视化图像产物。</p>
      </section>

      <!-- 二、检测结果 -->
      <section class="rpt-sec">
        <h2 class="rpt-sec-h">二、检测结果 <span class="en">FINDINGS</span></h2>
        <div v-if="defects.length" class="rpt-defects">
          <div v-for="(d, i) in defects" :key="i" class="rpt-defect">
            <span class="rpt-defect-id">D{{ i + 1 }}</span>
            <div class="rpt-defect-main">
              <div class="rpt-defect-name">{{ d.name }}<span v-if="d.type" class="type">{{ d.type }}</span></div>
              <p v-if="d.description" class="rpt-defect-desc">{{ d.description }}</p>
            </div>
            <div v-if="d.confidence != null" class="rpt-defect-conf"><b>{{ Math.round(d.confidence * 100) }}%</b>置信度</div>
          </div>
        </div>
        <p v-else class="rpt-empty">本任务未检出需报告的缺陷项。</p>

        <template v-if="classRows.length">
          <h3 class="rpt-table-h">检测类别定义</h3>
          <table class="rpt-table">
            <thead>
              <tr><th>代码</th><th>类别名称</th><th>类别说明</th><th>性质</th><th>检出</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in classRows" :key="c.code">
                <td class="code">{{ c.code }}</td>
                <td>{{ c.name }}</td>
                <td>{{ c.desc || '—' }}</td>
                <td><span class="rpt-nature" :class="c.isDefect ? 'defect' : 'false'">{{ c.isDefect ? '真缺陷' : '虚假' }}</span></td>
                <td class="rpt-detect">{{ c.detected }} 处</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>

      <!-- 三、知识库判级依据 -->
      <section v-if="citations.length" class="rpt-sec">
        <h2 class="rpt-sec-h">三、知识库判级依据 <span class="en">EVIDENCE</span></h2>
        <div class="rpt-cites">
          <div v-for="(k, i) in citations" :key="i" class="rpt-cite">
            <p class="rpt-cite-h">
              引用 {{ i + 1 }} — <span class="doc">《{{ k.doc_name }}》</span>
              <span class="score">相关度 {{ fmtScore(k.score) }}</span>
            </p>
            <blockquote class="rpt-cite-quote">{{ k.content }}</blockquote>
          </div>
        </div>
      </section>

      <!-- AI 综合分析 -->
      <section class="rpt-sec">
        <h2 class="rpt-sec-h">AI 综合分析 <span class="en">ANALYSIS</span></h2>
        <p v-if="reportError" class="rpt-empty">报告正文读取失败：{{ reportError }}</p>
        <p v-else-if="!report || !report.content" class="rpt-empty">报告正文尚未生成或为空。</p>
        <div v-else class="rpt-ai"><MarkdownView :text="report.content" /></div>
      </section>

      <footer class="rpt-foot">
        <span>本报告由智能质检 Agent 自动生成 · 判级依据 RAGFlow 知识库</span>
        <span>生成时间 {{ fmtDateTime(report?.meta?.generated_at || detail.updated_at) }}</span>
      </footer>
    </article>
  </div>
</template>
