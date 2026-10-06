<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import IconSvg from '@/components/IconSvg.vue';
import { generalCapabilities, capabilityCropX, domains, iconPath } from '@/data';
import { capabilityPresets } from '@/data/capability-presets';
import type { AnyCapability, GeneralCapability, ProfessionalCapability } from '@/data/types';
import { exportJsonDraft, formatSizeKB } from '@/utils/export';
import { setTheme, useTheme } from '@/composables/use-theme';
import {
  professionalCapabilities, refreshCapabilities, capsLoading, capsError, capsLive,
} from '@/composables/use-capabilities';
import { STATUS_LABEL, phaseLabel, adapterLabel, typeLabel } from '@/api/capability-registry';
import { sceneCodeToLabel } from '@/data/scene-map';
import { submitPpt, fetchDocument, documentDownloadUrl, type DocStatus, type DocumentResult, type PptOutline } from '@/api/ppt';
import { setDetectionHandoff } from '@/composables/use-detection';

const route = useRoute();
const router = useRouter();
const theme = useTheme();
onMounted(refreshCapabilities);

const all = computed<AnyCapability[]>(() => [...professionalCapabilities.value, ...generalCapabilities]);
const selected = computed<'professional' | 'general'>(() => (route.hash === '#general' ? 'general' : 'professional'));
const isProfessional = computed(() => selected.value === 'professional');
const list = computed<ProfessionalCapability[] | GeneralCapability[]>(() =>
  isProfessional.value ? professionalCapabilities.value : generalCapabilities);

const categoryTitle = computed(() => (isProfessional.value ? '专业能力' : '通用能力'));
const categoryDescription = computed(() =>
  isProfessional.value
    ? '面向工业图像分析，覆盖已注册登记的专业检测服务。'
    : '');
const categoryCount = computed(() => list.value.length + (isProfessional.value ? ' 项能力' : ' 项能力'));
const professionalCount = computed(() => String(professionalCapabilities.value.length).padStart(2, '0'));

/* 主题:深蓝样式的注入/卸载统一由 setTheme 处理(见 use-theme);切换控件已上提至顶部导航栏 */
setTheme(route.query.theme === 'dark' ? 'dark' : 'light');

const homeQuery = computed(() => (theme.value === 'dark' ? { theme: 'dark' } : {}));

/* 卡片视觉 */
const cardTags = (c: AnyCapability) =>
  'domains' in c ? c.domains.map((id) => domains.find((d) => d.id === id)?.name ?? id) : (c as GeneralCapability).tags;

/* 卡片标题：与首页一致，按 scene 取展示预设的缩写名（如「X 射线」）；无预设时回退注册表名称去备注 */
const cardTitle = (c: AnyCapability) => {
  if (isProfessionalItem(c) && c.scene && capabilityPresets[c.scene]) return capabilityPresets[c.scene].name;
  return c.name.replace(/[（(][^（）()]*[）)]\s*$/, '').trim();
};

const thumbStyle = (c: ProfessionalCapability, index: number) => {
  if (c.image) {
    return {
      backgroundImage: `url('${c.image}')`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  const crop = capabilityCropX[index % capabilityCropX.length];
  return {
    backgroundImage: "url('/assets/capability-reference.png')",
    backgroundSize: '983.53% auto',
    backgroundPosition: `${(crop / 1502) * 100}% 89%`,
  };
};

/* 真实字段徽标（仅注册表回填时展示；回退本地预设时无 status） */
const hasRegistry = (c: AnyCapability): c is ProfessionalCapability =>
  isProfessionalItem(c) && !!c.status;

/* 调用可用性门控：注册表回填且 status!=='enabled' 时不可调用；回退预设（无 status）允许。 */
const runnable = (c: AnyCapability) => !(hasRegistry(c) && c.status !== 'enabled');
const runLabel = (c: AnyCapability) =>
  hasRegistry(c) && c.status !== 'enabled' ? STATUS_LABEL[c.status!] : '调用';
const isMockAdapter = (c: AnyCapability) => isProfessionalItem(c) && c.adapter_type === 'mock';

/* ---------- 详情弹窗 ---------- */
const detail = reactive({ open: false, item: null as AnyCapability | null });

function openDetail(id: string) {
  const c = all.value.find((x) => x.id === id);
  if (!c) return;
  detail.item = c;
  detail.open = true;
}

function isProfessionalItem(c: AnyCapability | null): c is ProfessionalCapability {
  return !!c && 'domains' in c;
}

/* ---------- 需求配置弹窗 ---------- */
const configure = reactive({ open: false, item: null as AnyCapability | null });
const configureFiles = ref<File[]>([]);
const form = reactive({
  title: '', business_ref: '', pages: 10, audience: '',
  style: '简洁商务', recognition: '文字与表格', output: '可编辑文档', request: '',
});
const fileInputEl = ref<HTMLInputElement | null>(null);

const isPpt = computed(() => configure.item?.id === 'ppt');
const isOcr = computed(() => configure.item?.id === 'ocr');
const accept = computed(() => {
  const item = configure.item;
  const id = item?.id;
  if (id === 'ppt') return '.pdf,.doc,.docx,.txt,.md,.ppt,.pptx';
  if (id === 'ocr') return 'image/*,.pdf';
  if (isProfessionalItem(item) && item.scene === 'dr') return '.opi,.OPI';
  return 'image/*';
});

function openConfigure(id: string) {
  const c = all.value.find((x) => x.id === id);
  if (!c) return;
  detail.open = false;
  configure.item = c;
  configureFiles.value = [];
  Object.assign(form, {
    title: '', business_ref: '', pages: 10, audience: '',
    style: '简洁商务', recognition: '文字与表格', output: '可编辑文档', request: c.prompt,
  });
  configure.open = true;
}

function pickConfigureFiles() {
  fileInputEl.value?.click();
}
function onConfigureFiles(event: Event) {
  configureFiles.value = Array.from((event.target as HTMLInputElement).files ?? []);
}

function submitConfigure() {
  const c = configure.item;
  if (!c) return;
  if (!form.title.trim()) {
    message.warning('请填写有效的任务名称或主题。', 3.6);
    return;
  }
  const requirements: Record<string, unknown> = isPpt.value
    ? { title: form.title.trim(), pages: form.pages, audience: form.audience, style: form.style, request: form.request }
    : isOcr.value
      ? { title: form.title.trim(), recognition: form.recognition, output: form.output, request: form.request }
      : { title: form.title.trim(), business_ref: form.business_ref, request: form.request };
  const registry = isProfessionalItem(c)
    ? { capability_id: c.capability_id, scene: c.scene, capability_status: c.status }
    : {};
  exportJsonDraft(`${c.name}_需求草稿.json`, {
    status: '需求草稿，未执行',
    category: isProfessionalItem(c) ? '专业能力' : '通用能力',
    capability: c.name,
    ...registry,
    requirements,
    files: configureFiles.value.map((f) => ({ name: f.name, size: f.size })),
    expected_output: c.result,
  });
  message.success('需求草稿已导出，尚未执行任务。', 3.6);
}

/* ---------- 单工具调用：跳转智能检测并预选该能力（双入口） ---------- */
function goDetectSingle(c: ProfessionalCapability) {
  void router.push({ path: '/detection', query: { capability: c.id, ...homeQuery.value } });
}

/* ---------- PPT 制作：专用表单 → 后台生成 → 轮询 → 下载 .pptx ---------- */
type PptPhase = 'form' | 'running' | 'done' | 'error';
interface PptSectionRow { heading: string; bulletText: string }
const ppt = reactive({
  open: false,
  phase: 'form' as PptPhase,
  topic: '', audience: '', pages: 10, style: '简洁商务', request: '',
  outlineMode: 'ai' as 'ai' | 'manual',
  subtitle: '', closing: '',
  sections: [{ heading: '', bulletText: '' }] as PptSectionRow[],
  files: [] as File[],
  template: null as File | null,
  submitting: false,
  taskId: '',
  status: '' as DocStatus | '',
  result: null as DocumentResult | null,
  error: '',
});
const pptFileInput = ref<HTMLInputElement | null>(null);
const pptTemplateInput = ref<HTMLInputElement | null>(null);
const pptAccept = '.txt,.md,.markdown,.docx,.pdf';
let pptTimer: ReturnType<typeof setInterval> | null = null;
let pptPoll = 0;

function openPpt(c?: GeneralCapability) {
  Object.assign(ppt, {
    open: true, phase: 'form' as PptPhase,
    topic: '', audience: '', pages: 10, style: '简洁商务', request: '',
    outlineMode: 'ai' as const, subtitle: '', closing: '',
    sections: [{ heading: '', bulletText: '' }] as PptSectionRow[],
    files: [], template: null, submitting: false, taskId: '', status: '' as DocStatus | '', result: null, error: '',
  });
}
function closePpt() { stopPptPoll(); ppt.open = false; }
function pickPptFiles() { pptFileInput.value?.click(); }
function onPptFiles(event: Event) {
  ppt.files = Array.from((event.target as HTMLInputElement).files ?? []);
}
function pickPptTemplate() { pptTemplateInput.value?.click(); }
function onPptTemplate(event: Event) {
  ppt.template = (event.target as HTMLInputElement).files?.[0] ?? null;
}
function addPptSection() { ppt.sections.push({ heading: '', bulletText: '' }); }
function removePptSection(i: number) { if (ppt.sections.length > 1) ppt.sections.splice(i, 1); }
function stopPptPoll() { if (pptTimer) { clearInterval(pptTimer); pptTimer = null; } }

async function submitPptRun() {
  let outline: PptOutline | undefined;
  if (ppt.outlineMode === 'manual') {
    const sections = ppt.sections
      .map((s) => ({ heading: s.heading.trim(), bullets: s.bulletText.split('\n').map((x) => x.trim()).filter(Boolean) }))
      .filter((s) => s.heading || s.bullets.length);
    if (!sections.length) {
      message.warning('请至少填写一个章节（页标题或要点）。', 3.6);
      return;
    }
    outline = { title: ppt.topic.trim(), subtitle: ppt.subtitle.trim(), sections, closing: ppt.closing.trim() || '谢谢观看' };
  } else if (!ppt.topic.trim() && !ppt.request.trim()) {
    message.warning('请填写演示主题或补充要求。', 3.6);
    return;
  }
  ppt.submitting = true; ppt.error = ''; ppt.result = null;
  try {
    const { task_id } = await submitPpt({
      topic: ppt.topic.trim(), audience: ppt.audience.trim(), pages: ppt.pages,
      style: ppt.style, request: ppt.request.trim(), materials: ppt.files,
      outline, template: ppt.template,
    });
    ppt.taskId = task_id; ppt.status = 'pending'; ppt.phase = 'running';
    startPptPoll();
  } catch (err) {
    ppt.error = err instanceof Error ? err.message : String(err);
    ppt.phase = 'error';
  } finally {
    ppt.submitting = false;
  }
}

function startPptPoll() {
  pptPoll = 0;
  pptTimer = setInterval(async () => {
    pptPoll += 1;
    try {
      const d = await fetchDocument(ppt.taskId);
      ppt.status = d.status;
      if (d.status === 'completed') { ppt.result = d; ppt.phase = 'done'; stopPptPoll(); }
      else if (d.status === 'failed') { ppt.error = d.error || '生成失败'; ppt.phase = 'error'; stopPptPoll(); }
      else if (pptPoll >= 200) { ppt.error = '生成超时，可稍后在任务中心查看。'; ppt.phase = 'error'; stopPptPoll(); }
    } catch (err) {
      ppt.error = err instanceof Error ? err.message : String(err);
      ppt.phase = 'error'; stopPptPoll();
    }
  }, 1800);
}

onBeforeUnmount(stopPptPoll);

/* 将当前纯文本配置带到对话：拼成自然语言 prompt → 一次性交接 → 跳转 /detection 自动发送。
 * 聊天内 generate_ppt 只吃文本参数（主题/听众/页数/风格/要求），自定义大纲/模板/资料仍需在能力中心直接生成。 */
const pptCanHandoff = computed(() => ppt.outlineMode === 'ai' && ppt.files.length === 0 && !ppt.template);
function handoffPptToChat() {
  if (!pptCanHandoff.value) return;
  const topic = ppt.topic.trim();
  const req = ppt.request.trim();
  if (!topic && !req) {
    message.warning('请先填写演示主题或补充要求。', 3.6);
    return;
  }
  const meta: string[] = [];
  if (ppt.audience.trim()) meta.push(`目标听众 ${ppt.audience.trim()}`);
  if (ppt.pages) meta.push(`期望页数约 ${ppt.pages} 页`);
  if (ppt.style) meta.push(`呈现风格 ${ppt.style}`);
  let text = topic ? `请帮我制作一份 PPT：主题《${topic}》` : '请帮我制作一份 PPT';
  if (meta.length) text += `（${meta.join('，')}）`;
  if (req) text += `。补充要求：${req}`;
  text += '。';
  setDetectionHandoff(text);
  closePpt();
  void router.push({ path: '/detection', query: homeQuery.value });
}
</script>

<template>
  <div class="center-layout">
    <aside class="catalog-sidebar">
      <RouterLink class="back-home" :to="{ path: '/', query: homeQuery }"><IconSvg name="home" />全景首页</RouterLink>
      <div class="catalog-label">能力中心</div>
      <nav class="category-nav" aria-label="能力分类">
        <RouterLink to="#professional" data-category="professional" :class="{ selected: isProfessional }" :aria-current="isProfessional ? 'page' : undefined">
          <IconSvg name="scan" /><span>专业能力</span><b>{{ professionalCount }}</b>
        </RouterLink>
        <RouterLink to="#general" data-category="general" :class="{ selected: !isProfessional }" :aria-current="!isProfessional ? 'page' : undefined">
          <IconSvg name="spark" /><span>通用能力</span><b>02</b>
        </RouterLink>
      </nav>
      <div class="sidebar-note">
        <IconSvg name="spark" />
        <h2>从需求开始</h2>
        <p>不确定选择哪项能力？<br>向智能视觉助手描述你的目标。</p>
        <RouterLink :to="{ path: '/', query: { ...homeQuery, module: '智能检测' } }">打开智能视觉助手</RouterLink>
      </div>
      <div class="sidebar-bottom">统一入口 · 专业执行</div>
    </aside>

    <main class="center-main">
      <div class="center-topline">
        <nav class="breadcrumbs" aria-label="面包屑">
          <RouterLink :to="{ path: '/', query: homeQuery }">首页</RouterLink>
          <span>/</span><span>能力中心</span><span>/</span><strong>{{ categoryTitle }}</strong>
        </nav>
      </div>

      <div class="center-title">
        <div>
          <p class="center-eyebrow">CAPABILITY CENTER</p>
          <h1>能力中心</h1>
          <p class="center-subtitle">按业务目标选择能力，开始你的专业分析与智能协作。</p>
        </div>
        <span v-if="capsLive" class="preview-badge live">真实注册</span>
        <span v-else class="preview-badge">交互原型</span>
      </div>

      <p v-if="capsError" class="caps-banner">后端不可达，已回退本地预设展示（{{ capsError }}）。</p>

      <section aria-labelledby="category-title">
        <div class="category-heading">
          <div>
            <h2 id="category-title">{{ categoryTitle }}</h2>
            <p>{{ categoryDescription }}</p>
          </div>
          <span>{{ categoryCount }}</span>
        </div>
        <div v-if="capsLoading && !list.length" class="center-cards" aria-hidden="true">
          <div v-for="n in 6" :key="n" class="ability-card cap-skeleton">
            <div class="sk-image"></div>
            <div class="ability-body">
              <div class="sk-line sk-title"></div>
              <div class="sk-line"></div>
              <div class="sk-line sk-short"></div>
            </div>
          </div>
        </div>
        <div v-else class="center-cards" :class="{ 'general-grid': !isProfessional }">
          <article v-for="(c, i) in list" :key="c.id" class="ability-card gen-card">
            <!-- 专业卡片：保留原结构 -->
            <template v-if="isProfessional">
              <div class="card-image" :style="thumbStyle(c as ProfessionalCapability, i)">
                <span class="image-type">专业检测 / 0{{ i + 1 }}</span>
              </div>
              <div class="ability-body">
                <div class="ability-title">
                  <h3>{{ cardTitle(c) }}</h3>
                  <span>专业能力</span>
                </div>
                <div v-if="hasRegistry(c)" class="cap-badges">
                  <span class="cap-badge" :data-status="c.status">
                    <i class="cap-status-dot"></i>{{ STATUS_LABEL[c.status!] }}
                  </span>
                  <span v-if="c.lifecycle_phase" class="cap-badge">{{ phaseLabel(c.lifecycle_phase) }}</span>
                  <span v-if="c.adapter_type" class="cap-badge">{{ adapterLabel(c.adapter_type) }}</span>
                  <code v-if="c.endpoint" class="cap-endpoint" :title="c.endpoint">{{ c.endpoint }}</code>
                </div>
                <dl class="ability-io">
                  <div><dt>输入</dt><dd>{{ c.input }}</dd></div>
                  <div><dt>输出</dt><dd>{{ c.result }}</dd></div>
                </dl>
                <div class="ability-actions run-actions">
                  <button
                    class="center-primary" type="button"
                    :disabled="!runnable(c)"
                    :aria-label="`调用${c.name}智能体`" @click="goDetectSingle(c as ProfessionalCapability)"
                  >{{ runLabel(c) }}</button>
                  <span v-if="isMockAdapter(c)" class="run-demo-tag">演示</span>
                </div>
              </div>
            </template>

            <!-- 通用卡片：新结构 -->
            <template v-else>
              <div class="gen-card-header">
                <div class="gen-icon-box" :class="c.id === 'ppt' ? 'ppt' : 'ocr'">
                  <IconSvg :name="c.icon" />
                </div>
                <div class="gen-title-row">
                  <h3>{{ c.name }}</h3>
                  <span>{{ (c as GeneralCapability).en }}</span>
                </div>
              </div>

              <div class="gen-card-preview" :class="c.id === 'ppt' ? 'ppt' : 'ocr'">
                <!-- OCR 预览图：文档扫描效果 -->
                <template v-if="c.id === 'ocr'">
                  <svg viewBox="0 0 480 260" class="gen-illust-svg">
                    <rect x="60" y="40" width="360" height="180" rx="8" fill="#f0f5fb" stroke="#dce6f1" stroke-width="2"/>
                    <rect x="90" y="70" width="180" height="10" rx="3" fill="#b8cce4"/>
                    <rect x="90" y="95" width="140" height="10" rx="3" fill="#b8cce4"/>
                    <rect x="90" y="120" width="160" height="10" rx="3" fill="#b8cce4"/>
                    <rect x="90" y="145" width="120" height="10" rx="3" fill="#b8cce4"/>
                    <rect x="300" y="70" width="90" height="10" rx="3" fill="#d0e0f0"/>
                    <rect x="300" y="95" width="70" height="10" rx="3" fill="#d0e0f0"/>
                    <rect x="300" y="120" width="80" height="10" rx="3" fill="#d0e0f0"/>
                    <!-- 扫描框角标 -->
                    <path d="M 70 50 L 70 70 M 70 50 L 90 50" stroke="#2769e5" stroke-width="3" fill="none" stroke-linecap="round"/>
                    <path d="M 410 50 L 410 70 M 410 50 L 390 50" stroke="#2769e5" stroke-width="3" fill="none" stroke-linecap="round"/>
                    <path d="M 70 210 L 70 190 M 70 210 L 90 210" stroke="#2769e5" stroke-width="3" fill="none" stroke-linecap="round"/>
                    <path d="M 410 210 L 410 190 M 410 210 L 390 210" stroke="#2769e5" stroke-width="3" fill="none" stroke-linecap="round"/>
                    <!-- 表格示意 -->
                    <rect x="200" y="170" width="180" height="40" rx="4" fill="none" stroke="#a0b8d0" stroke-width="1.5"/>
                    <line x1="260" y1="170" x2="260" y2="210" stroke="#a0b8d0" stroke-width="1"/>
                    <line x1="320" y1="170" x2="320" y2="210" stroke="#a0b8d0" stroke-width="1"/>
                    <line x1="200" y1="190" x2="380" y2="190" stroke="#a0b8d0" stroke-width="1"/>
                  </svg>
                </template>
                <!-- PPT 预览图：幻灯片堆叠效果 -->
                <template v-else>
                  <svg viewBox="0 0 480 260" class="gen-illust-svg">
                    <!-- 背景幻灯片 -->
                    <rect x="100" y="50" width="200" height="150" rx="6" fill="#e9e6ff" stroke="#d0c8f0" stroke-width="1.5" transform="rotate(-8 200 125)"/>
                    <rect x="120" y="70" width="100" height="8" rx="2" fill="#c8c0e8" transform="rotate(-8 200 125)"/>
                    <rect x="120" y="90" width="80" height="8" rx="2" fill="#c8c0e8" transform="rotate(-8 200 125)"/>
                    <rect x="120" y="110" width="90" height="8" rx="2" fill="#c8c0e8" transform="rotate(-8 200 125)"/>
                    <!-- 中间幻灯片 -->
                    <rect x="160" y="40" width="220" height="160" rx="6" fill="#ffffff" stroke="#d0c8f0" stroke-width="2"/>
                    <rect x="190" y="65" width="120" height="10" rx="3" fill="#a89fd8"/>
                    <rect x="190" y="90" width="100" height="8" rx="2" fill="#d0c8f0"/>
                    <rect x="190" y="110" width="80" height="8" rx="2" fill="#d0c8f0"/>
                    <rect x="190" y="130" width="90" height="8" rx="2" fill="#d0c8f0"/>
                    <!-- 图表示意 -->
                    <circle cx="310" cy="120" r="25" fill="none" stroke="#a89fd8" stroke-width="2"/>
                    <path d="M 310 95 A 25 25 0 0 1 335 120" fill="#c8c0e8" stroke="none"/>
                    <!-- 前景幻灯片 -->
                    <rect x="240" y="55" width="180" height="140" rx="6" fill="#f0edff" stroke="#d8d0f0" stroke-width="1.5" transform="rotate(6 330 125)"/>
                    <rect x="265" y="80" width="90" height="8" rx="2" fill="#b8b0e0" transform="rotate(6 330 125)"/>
                    <rect x="265" y="100" width="70" height="8" rx="2" fill="#b8b0e0" transform="rotate(6 330 125)"/>
                    <rect x="265" y="120" width="80" height="8" rx="2" fill="#b8b0e0" transform="rotate(6 330 125)"/>
                    <rect x="265" y="140" width="60" height="8" rx="2" fill="#b8b0e0" transform="rotate(6 330 125)"/>
                  </svg>
                </template>
              </div>

              <div class="gen-card-body">
                <p class="gen-desc">{{ c.desc }}</p>
                <div class="gen-tags"><span v-for="t in cardTags(c)" :key="t">{{ t }}</span></div>
                <dl class="gen-io">
                  <div><dt>输入</dt><dd>{{ c.input }}</dd></div>
                  <div><dt>输出</dt><dd>{{ c.result }}</dd></div>
                </dl>
                <div class="gen-actions">
                  <button v-if="c.id === 'ppt'" class="gen-cta-btn" type="button" @click="openPpt(c as GeneralCapability)">制作 PPT →</button>
                  <button v-else class="gen-cta-btn" type="button" @click="openConfigure(c.id)">开始识别 →</button>
                </div>
              </div>
            </template>
          </article>
        </div>
      </section>

      <!-- <div class="center-footnote">
        <IconSvg name="shield" />
        <p></p>
      </div> -->
    </main>
  </div>

  <!-- 能力详情 -->
  <a-modal v-model:open="detail.open" :footer="null" :width="720" :style="{ top: '6vh' }" class="agent-modal center-detail-modal">
    <template #title>
      <div>
        <p>{{ detail.item && isProfessionalItem(detail.item) ? '专业能力 / 专业图像分析' : '通用能力 / AGENT' }}</p>
        <h2>{{ detail.item?.name }}</h2>
      </div>
    </template>
    <div class="dialog-body" v-if="detail.item">
      <div class="center-dialog-content">
        <p class="detail-lead">{{ detail.item.desc }}。</p>
        <div class="detail-pair">
          <section><h3>输入资料</h3><p>{{ detail.item.input }}</p></section>
          <section><h3>预期输出</h3><p>{{ detail.item.result }}</p></section>
        </div>
        <template v-if="hasRegistry(detail.item)">
          <h3>注册信息</h3>
          <dl class="cap-registry-info">
            <div><dt>能力 ID</dt><dd><code>{{ detail.item.capability_id || '—' }}</code></dd></div>
            <div><dt>场景</dt><dd>{{ sceneCodeToLabel(detail.item.scene) }}<span v-if="detail.item.scene" class="cap-scene-code">（{{ detail.item.scene }}）</span></dd></div>
            <div><dt>生命周期阶段</dt><dd>{{ detail.item.lifecycle_phase ? phaseLabel(detail.item.lifecycle_phase) : '—' }}</dd></div>
            <div><dt>结果类型</dt><dd>{{ detail.item.capability_type ? typeLabel(detail.item.capability_type) : '—' }}</dd></div>
            <div><dt>适配器</dt><dd>{{ detail.item.adapter_type ? adapterLabel(detail.item.adapter_type) : '—' }}</dd></div>
            <div><dt>端点</dt><dd><code>{{ detail.item.endpoint || '—' }}</code></dd></div>
            <div><dt>状态</dt><dd><span class="cap-badge" :data-status="detail.item.status"><i class="cap-status-dot"></i>{{ STATUS_LABEL[detail.item.status!] }}</span></dd></div>
          </dl>
        </template>
        <h3>处理流程</h3>
        <ol class="process-steps">
          <li v-for="(v, i) in detail.item.flow" :key="v"><span>0{{ i + 1 }}</span>{{ v }}</li>
        </ol>
        <p v-if="detail.item.id === 'thermal'" class="center-notice">热部图像的检测对象与算法目标需在业务确认后固化。</p>
        <p class="center-notice">此处用于查看能力与配置需求；接入服务后执行实际分析或内容生成。</p>
      </div>
    </div>
    <div class="dialog-actions">
      <a-button @click="detail.open = false">返回列表</a-button>
      <a-button type="primary" @click="detail.item && openConfigure(detail.item.id)">配置需求</a-button>
    </div>
  </a-modal>

  <!-- 需求配置表单（配置需求功能暂时隐藏，本页将改造为单智能体调用入口） -->
  <a-modal v-if="false" v-model:open="configure.open" :footer="null" :width="720" :style="{ top: '6vh' }" class="agent-modal">
    <template #title>
      <div>
        <p>{{ configure.item && isProfessionalItem(configure.item) ? '专业能力 / 需求配置' : '通用能力 / 需求配置' }}</p>
        <h2>配置{{ configure.item?.name }}需求</h2>
      </div>
    </template>
    <div class="dialog-body" v-if="configure.item">
      <form class="center-dialog-content agent-form" @submit.prevent="submitConfigure">
        <p class="detail-lead">
          {{ configure.item.id === 'ppt' ? '说明主题、听众和篇幅，组织你的汇报需求。'
            : configure.item.id === 'ocr' ? '选择资料与识别目标，准备文字提取需求。'
              : '确认业务对象与输入资料，准备专业分析需求。' }}
        </p>
        <label>{{ isPpt ? '演示主题' : '任务名称' }}
          <a-input v-model:value="form.title" :maxlength="120" required
            :placeholder="isPpt ? '例如：工业图像智能检测平台建设汇报' : configure.item.name + '任务'" />
        </label>
        <div class="upload-zone" @click="pickConfigureFiles">
          <svg viewBox="0 0 24 24" aria-hidden="true" v-html="iconPath('paperclip')" />
          <strong>{{ isPpt ? '添加参考资料或模板' : '添加待处理资料' }}</strong>
          <span>{{ configure.item.input }}</span>
          <input ref="fileInputEl" type="file" multiple :accept="accept" @change="onConfigureFiles" @click.stop>
        </div>
        <ul class="request-files">
          <li v-for="f in configureFiles" :key="`${f.name}-${f.size}-${f.lastModified}`">{{ f.name }} · {{ formatSizeKB(f.size) }}</li>
        </ul>
        <div v-if="isPpt" class="form-pair">
          <label>预计页数
            <a-input-number v-model:value="form.pages" :min="3" :max="60" style="width:100%" />
          </label>
          <label>目标听众<a-input v-model:value="form.audience" :maxlength="100" placeholder="例如：项目评审组" /></label>
        </div>
        <label v-if="isPpt">呈现风格
          <a-select v-model:value="form.style" style="width:100%" :options="['简洁商务', '科技汇报', '学术交流'].map((v) => ({ value: v, label: v }))" />
        </label>
        <div v-if="isOcr" class="form-pair">
          <label>识别目标
            <a-select v-model:value="form.recognition" style="width:100%" :options="['文字与表格', '仅文字', '仅表格'].map((v) => ({ value: v, label: v }))" />
          </label>
          <label>输出形式
            <a-select v-model:value="form.output" style="width:100%" :options="['可编辑文档', '纯文本', '结构化表格'].map((v) => ({ value: v, label: v }))" />
          </label>
        </div>
        <label v-if="!isPpt && !isOcr">零件 / 批次编号
          <a-input v-model:value="form.business_ref" :maxlength="100" placeholder="填写业务对象编号" />
        </label>
        <label>{{ isPpt ? '内容要求' : '补充说明' }}
          <a-textarea v-model:value="form.request" :rows="3" :maxlength="3000" :placeholder="configure.item.prompt" />
        </label>
        <p class="center-notice">导出的是需求草稿，不会执行任务或上传文件。草稿仅记录文件名称与大小，不包含文件内容。</p>
        <div class="dialog-actions">
          <a-button @click="configure.open = false">返回列表</a-button>
          <a-button @click="configure.item && (configure.open = false, openDetail(configure.item.id))">查看能力说明</a-button>
          <a-button type="primary" html-type="submit">导出需求草稿</a-button>
        </div>
      </form>
    </div>
  </a-modal>

  <!-- PPT 制作：表单 / 生成中 / 完成下载 / 失败 -->
  <a-modal :open="ppt.open" :footer="null" :width="720" :style="{ top: '5vh' }" class="agent-modal ppt-modal" @cancel="closePpt">
    <template #title>
      <div class="ppt-modal-header">
        <div class="ppt-modal-icon"><IconSvg name="report" /></div>
        <div>
          <h2>PPT 制作</h2>
          <span class="ppt-modal-desc">根据主题或自定义大纲，生成可下载的 PPTX 文件。</span>
        </div>
      </div>
    </template>
    <div class="dialog-body">
      <div class="ppt-modal-form">
        <template v-if="ppt.phase === 'form'">
          <!-- 演示主题 -->
          <div class="ppt-field">
            <label class="ppt-field-label">演示主题 <span class="ppt-required">*</span></label>
            <a-input v-model:value="ppt.topic" :maxlength="120" placeholder="例如：工业图像智能检测平台建设汇报" />
          </div>
  
          <!-- 大纲来源 -->
          <div class="ppt-field">
            <label class="ppt-field-label">大纲来源</label>
            <div class="ppt-radio-cards">
              <label class="ppt-radio-card" :class="{ active: ppt.outlineMode === 'ai' }">
                <input type="radio" v-model="ppt.outlineMode" value="ai" />
                <span class="ppt-radio-dot"></span>
                <span>AI 生成大纲</span>
              </label>
              <label class="ppt-radio-card" :class="{ active: ppt.outlineMode === 'manual' }">
                <input type="radio" v-model="ppt.outlineMode" value="manual" />
                <span class="ppt-radio-dot"></span>
                <span>自定义大纲</span>
              </label>
            </div>
            <p class="ppt-field-hint">根据主题与参考资料生成大纲，可补充重点内容。</p>
          </div>
  
          <!-- 目标听众 / 预计页数 / 呈现风格 -->
          <div class="ppt-field-row">
            <div class="ppt-field ppt-field-col">
              <label class="ppt-field-label">目标听众</label>
              <a-input v-model:value="ppt.audience" :maxlength="100" placeholder="例如：项目评审组" />
            </div>
            <div class="ppt-field ppt-field-col ppt-field-stepper">
              <label class="ppt-field-label">预计页数</label>
              <div class="ppt-stepper">
                <button type="button" class="ppt-stepper-btn" @click="ppt.pages = Math.max(3, ppt.pages - 1)">−</button>
                <span class="ppt-stepper-val">{{ ppt.pages }}</span>
                <button type="button" class="ppt-stepper-btn" @click="ppt.pages = Math.min(40, ppt.pages + 1)">+</button>
              </div>
            </div>
            <div class="ppt-field ppt-field-col">
              <label class="ppt-field-label">呈现风格</label>
              <a-select v-model:value="ppt.style" style="width:100%" :options="['简洁商务', '科技汇报', '学术交流'].map((v) => ({ value: v, label: v }))" />
            </div>
          </div>
  
          <!-- 上传区：参考资料 + PPT 模板 -->
          <div class="ppt-upload-row">
            <div class="ppt-upload-zone" @click="pickPptFiles">
              <svg viewBox="0 0 24 24" aria-hidden="true" v-html="iconPath('paperclip')" />
              <div>
                <strong>参考资料 <span class="ppt-optional">（可选）</span></strong>
                <span>TXT / MD / DOCX / PDF</span>
              </div>
              <input ref="pptFileInput" type="file" multiple :accept="pptAccept" @change="onPptFiles" @click.stop />
            </div>
            <div class="ppt-upload-zone" @click="pickPptTemplate">
              <svg viewBox="0 0 24 24" aria-hidden="true" v-html="iconPath('paperclip')" />
              <div>
                <strong>PPT 模板 <span class="ppt-optional">（可选）</span></strong>
                <span>上传 PPTX，沿用母版与主题</span>
              </div>
              <input ref="pptTemplateInput" type="file" accept=".pptx" @change="onPptTemplate" @click.stop />
            </div>
          </div>
          <ul v-if="ppt.files.length" class="request-files">
            <li v-for="f in ppt.files" :key="`${f.name}-${f.size}-${f.lastModified}`">{{ f.name }} · {{ formatSizeKB(f.size) }}</li>
          </ul>
          <p v-if="ppt.template" class="ppt-template-tag">已选模板：{{ ppt.template.name }}
            <a @click="ppt.template = null">移除</a>
          </p>
  
          <!-- 内容要求 -->
          <div class="ppt-field">
            <label class="ppt-field-label">内容要求 <span class="ppt-optional">（可选）</span></label>
            <a-textarea v-model:value="ppt.request" :rows="3" :maxlength="3000" placeholder="补充汇报重点、章节方向或表达要求…" />
          </div>
  
          <p v-if="ppt.error" class="ppt-err">{{ ppt.error }}</p>
  
          <!-- 页脚 -->
          <div class="ppt-modal-footer">
            <span class="ppt-output-format"><IconSvg name="report" /> 输出格式：.pptx</span>
            <div class="ppt-footer-actions">
              <a-button @click="closePpt">取消</a-button>
              <a-button type="primary" :loading="ppt.submitting" @click="submitPptRun">生成 PPT</a-button>
            </div>
          </div>
        </template>
  
        <div v-else-if="ppt.phase === 'running'" class="ppt-progress">
          <a-spin />
          <p>正在组织大纲并生成演示文稿…</p>
          <span class="ppt-task-id">任务号 <code>{{ ppt.taskId }}</code>（{{ ppt.status }}）</span>
        </div>
  
        <div v-else-if="ppt.phase === 'done' && ppt.result" class="ppt-done">
          <p class="detail-lead">演示文稿已生成，可下载到本地继续编辑。</p>
          <dl class="cap-registry-info">
            <div><dt>文件名</dt><dd>{{ ppt.result.filename }}</dd></div>
            <div><dt>页数</dt><dd>约 {{ ppt.result.slide_count }} 页</dd></div>
            <div><dt>大纲来源</dt><dd>{{ ppt.result.engine === 'llm' ? '内网大模型' : ppt.result.engine === 'manual' ? '自定义大纲' : '本地模板（大模型不可用时自动降级）' }}</dd></div>
          </dl>
          <p v-if="ppt.result.material_notes && ppt.result.material_notes.length" class="caps-banner">部分资料未纳入：{{ ppt.result.material_notes.join('；') }}</p>
          <div class="dialog-actions">
            <a-button @click="ppt.phase = 'form'">再做一份</a-button>
            <a class="center-primary ppt-download" :href="documentDownloadUrl(ppt.result.artifact_uri || '')" target="_blank" rel="noopener">下载 .pptx</a>
          </div>
        </div>
  
        <div v-else class="ppt-error">
          <p class="ppt-err">{{ ppt.error || '生成失败' }}</p>
          <div class="dialog-actions">
            <a-button @click="ppt.phase = 'form'">返回修改</a-button>
            <a-button type="primary" @click="closePpt">关闭</a-button>
          </div>
        </div>
      </div>
    </div>
  </a-modal>
</template>
