<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import IconSvg from '@/components/IconSvg.vue';
import MarkdownView from '@/components/MarkdownView.vue';
import DetCardItem from '@/components/DetCardItem.vue';
import StageStepper from '@/components/StageStepper.vue';
import TaskDetailModal from '@/components/TaskDetailModal.vue';
import ModelPicker from '@/components/ModelPicker.vue';
import SendButton from '@/components/SendButton.vue';
import { capabilities } from '@/data';
import { sceneCodeToLabel } from '@/data/scene-map';
import { nodeLabel, type StageProgress } from '@/data/inspection-stages';
import { tasksLive } from '@/composables/use-tasks';
import { formatSizeKB } from '@/utils/export';
import { setTheme, useTheme, activeNav } from '@/composables/use-theme';
import { openImagePreview } from '@/composables/use-image-preview';
import { useFilePicker } from '@/composables/use-file-picker';
import {
  conversationCount, conversations, items, hasActive, activeId, sending, error, isRemote,
  newConversation, openConversation, removeConversation, renameConversation,
  sendRequest, initDetection, teardownDetection,
  consumeDetectionHandoff, agentBusy, agentTurnBusy, agentPhase, retryLast, regenerateLast,
  runningTaskCards, taskProgress, openTaskDetail,
} from '@/composables/use-detection';

const route = useRoute();
const theme = useTheme();
const dark = computed(() => theme.value === 'dark');

/* 主题:进入页面按 URL 同步;深蓝样式注入/卸载统一由 setTheme 处理 */
setTheme(route.query.theme === 'dark' ? 'dark' : 'light');
onMounted(() => {
  activeNav.value = '智能检测';
  // 双入口：能力中心「调用」跳转过来时，按 query 预选单工具方向
  const cap = route.query.capability;
  if (typeof cap === 'string' && capabilities.some((c) => c.id === cap)) {
    chooseCapability(cap, { prefill: true });
  }
  // 首页「开始对话」跳转过来时，携带输入内容预填并聚焦
  const homePrompt = route.query.prompt;
  if (typeof homePrompt === 'string' && homePrompt.trim()) {
    prompt.value = homePrompt;
    void nextTick(() => textareaEl.value?.focus());
  }
  // 先拉取历史会话列表填充侧栏（initDetection 只刷新 sessions，不重置当前线程/消息流）；
  // 会话就绪后消费能力中心的一次性交接：远程直接开新线程自动发送，演示模式退化为预填。
  void initDetection().then(() => {
    const handoff = consumeDetectionHandoff();
    if (!handoff) return;
    if (isRemote) {
      // 强制开新线程：确保 sendRemote 重新订阅消息流（旧流可能已随上一个页面卸载而关闭）
      newConversation();
      void sendRequest(handoff, [], 'auto');
    } else {
      prompt.value = handoff;
      void nextTick(() => textareaEl.value?.focus());
    }
  });
});

/* ---------- 输入与方向选择 ---------- */
const prompt = ref('');
const direction = ref('auto');
const files = ref<File[]>([]);
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const threadEl = ref<HTMLElement | null>(null);
const searchQuery = ref('');

/* 输入框增强：左下加号菜单（添加文件 / 选择检测方向）；模型切换已抽为 <ModelPicker> */
const plusOpen = ref(false);
function pickDirection(id: string) { chooseCapability(id); plusOpen.value = false; }

const directionChips = [
  { value: 'auto', label: '自动' },
  ...capabilities.map((c) => ({ value: c.id, label: c.name })),
];

const isStart = computed(() => !hasActive.value || items.value.length === 0);

/* ---------- 贴底自动滚动 + “回到底部”胶囊 ----------
 * 流式输出时若用户在底部附近则持续跟随；一旦上滚查看历史即停止打扰，
 * 改由右下角浮动胶囊提示“有新内容”，点击回底。 */
const isAtBottom = ref(true);
const showJump = ref(false);
function onThreadScroll() {
  const el = threadEl.value;
  if (!el) return;
  isAtBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  if (isAtBottom.value) showJump.value = false;
}
function scrollThreadToBottom(smooth = false) {
  const el = threadEl.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  isAtBottom.value = true;
  showJump.value = false;
}
function jumpToBottom() { scrollThreadToBottom(true); }
// 内容增长（新条目 / 末条文本变长 / 工作条出现）时：在底部则跟随，否则亮胶囊
const threadSig = computed(() => {
  const n = items.value.length;
  const last = items.value[n - 1];
  return n + ':' + (last?.text?.length ?? 0) + ':' + (agentBusy.value ? 1 : 0);
});
watch(threadSig, () => {
  if (isStart.value) return;
  if (isAtBottom.value) void nextTick(() => scrollThreadToBottom(false));
  else showJump.value = true;
});
// 切换会话：重置为贴底并跳到最新
watch(activeId, () => {
  isAtBottom.value = true;
  showJump.value = false;
  void nextTick(() => scrollThreadToBottom(false));
});

/** 当前选中方向的能力对象 */
const selectedCap = computed(() => capabilities.find((c) => c.id === direction.value) ?? null);

/** 快捷建议 chips */
const suggestions = computed(() => {
  if (!selectedCap.value) return ['定位异常区域', '汇总检测结果', '生成报告草稿'];
  const flow = selectedCap.value.flow;
  return flow.slice(0, 3).map((s) => s.replace(/与/g, '').slice(0, 8));
});

/* ---------- 侧栏折叠与相对时间 ---------- */
const sidebarCollapsed = ref(false);
function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60000;
  const hr = 3600000;
  const day = 86400000;
  if (diff < min) return '刚刚';
  if (diff < hr) return `${Math.floor(diff / min)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hr)}小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;
  return new Date(ts).toLocaleDateString();
}

/* ---------- 会话重命名(行内编辑,与知识页同款交互) ---------- */
const renamingId = ref<string | null>(null);
const renameDraft = ref('');
const renameEl = ref<HTMLInputElement | null>(null);
function startRename(id: string, title: string) {
  renamingId.value = id;
  renameDraft.value = title;
  void nextTick(() => { renameEl.value?.focus(); renameEl.value?.select(); });
}
async function commitRename(id: string) {
  if (renamingId.value !== id) return;
  renamingId.value = null;
  const clean = renameDraft.value.trim();
  if (!clean || clean === titleOf(id)) return;
  await renameConversation(id, clean);
}
function titleOf(id: string): string {
  return conversations.value.find((s) => s.id === id)?.title ?? '';
}

/** 会话按时间分组 */
interface ConvGroup { label: string; list: { id: string; title: string; updatedAt: number; sub: string }[] }
const groupedConversations = computed<ConvGroup[]>(() => {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const groups: Record<string, ConvGroup> = {};
  for (const t of conversations.value) {
    let label: string;
    if (t.updatedAt >= todayStart.getTime()) label = '今天';
    else if (t.updatedAt >= yesterdayStart.getTime()) label = '昨天';
    else label = '更早';
    if (!groups[label]) groups[label] = { label, list: [] };
    groups[label].list.push({ id: t.id, title: t.title, updatedAt: t.updatedAt, sub: `${relTime(t.updatedAt)} · ${t.lastMessage ? t.lastMessage.slice(0, 10) + '…' : '新对话'}` });
  }
  const order = ['今天', '昨天', '更早'];
  return order.filter((k) => groups[k]).map((k) => groups[k]);
});

/* ---------- 渲染辅助 ----------
 * 思考行默认展开/折叠策略（对齐千问）：流式进行中自动展开并打字机展示，
 * 思考结束后自动折叠；一旦用户手动开合过，则以手动状态为准。 */
const collapsed = reactive<Record<string, boolean>>({});
function isCollapsed(it: { id: string; streaming: boolean }): boolean {
  const manual = collapsed[it.id];
  if (manual !== undefined) return manual;
  return !it.streaming;
}
function toggleThinking(it: { id: string; streaming: boolean }) {
  collapsed[it.id] = !isCollapsed(it);
}

/** 思考流式展开时，让文本框自动滚到最新一行（打字机跟随效果）。 */
function autoScrollThinking(it: { streaming: boolean }, el: HTMLElement | null) {
  if (it.streaming && el) el.scrollTop = el.scrollHeight;
}

/** 工具调用步序：按出现顺序给每个 chain 条目编号（total>1 时展示“步骤 N”）。 */
const chainStepMap = computed<Record<string, { no: number; total: number }>>(() => {
  const chains = items.value.filter((it) => it.kind === 'chain');
  const total = chains.length;
  const m: Record<string, { no: number; total: number }> = {};
  chains.forEach((it, i) => { m[it.id] = { no: i + 1, total }; });
  return m;
});

/** 最后一条已完成的助手回答 id（供“重新生成”定位）。 */
const lastAssistantId = computed<string>(() => {
  const arr = items.value;
  for (let i = arr.length - 1; i >= 0; i--) {
    const it = arr[i];
    if (it.kind === 'assistant' && !it.streaming && it.text) return it.id;
  }
  return '';
});

/* ---------- 消息图片：后端回推 {uri,name} 引用，uri 为 /api/v1/tasks/.../files/... 可直接作 img src ---------- */
interface MsgImage { src: string; name: string }
interface MsgImageSplit { images: MsgImage[]; chips: string[] }
/** 归一化 images 元素：对象取 uri/src，字符串仅 http/data URL 可渲染；不可渲染的退化为文件名胶囊。
 *  按原数组引用缓存，避免模板多处调用重复计算。 */
const _splitCache = new WeakMap<any[], MsgImageSplit>();
function splitImages(raw: any[]): MsgImageSplit {
  const hit = _splitCache.get(raw);
  if (hit) return hit;
  const images: MsgImage[] = [];
  const chips: string[] = [];
  for (const f of raw ?? []) {
    const src = typeof f === 'string'
      ? (/^(https?:|data:)\S*/i.test(f) ? f : '')
      : String(f?.uri || f?.src || f?.url || '');
    const name = (typeof f === 'object' && f?.name) ? String(f.name) : src.split(/[?#]/)[0].split(/[\\/]/).pop() || '图像';
    if (src) images.push({ src, name });
    else chips.push(name);
  }
  const out = { images, chips };
  try { _splitCache.set(raw, out); } catch { /* 非对象引用不缓存 */ }
  return out;
}
function openMsgImages(it: { images: any[] }, index: number) {
  const { images } = splitImages(it.images);
  if (images[index]) openImagePreview(images, index);
}

/** 复制单条回答（原始 Markdown 文本），短暂回显“已复制”。 */
const copiedId = ref('');
let _copyTimer: ReturnType<typeof setTimeout> | null = null;
async function copyAnswer(it: { id: string; text: string }) {
  if (!it.text) return;
  try {
    await navigator.clipboard.writeText(it.text);
    copiedId.value = it.id;
    if (_copyTimer) clearTimeout(_copyTimer);
    _copyTimer = setTimeout(() => { copiedId.value = ''; }, 1600);
  } catch {
    message.error('复制失败，请手动选择文本复制。');
  }
}

/** 工具调用行：从 args 里挑一个可读字段作摘要；pretty 用于展开时美化 JSON。 */
function clip(s: string, n = 64): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}
function chainSummary(it: { args?: any }): string {
  const a = it.args;
  if (a == null) return '';
  if (typeof a === 'string') return clip(a);
  if (typeof a === 'object') {
    const keys = ['query', 'question', 'keyword', 'keywords', 'scene', 'summary', 'message', 'text', 'task_id', 'path', 'name'];
    for (const k of keys) {
      const v = (a as any)[k];
      if (typeof v === 'string' && v.trim()) {
        // 场景英文码（fpi/borescope/...）转中文简称，与卡片头部口径一致；未知码原样返回
        if (k === 'scene') return sceneCodeToLabel(v.trim());
        return clip(v);
      }
    }
    const firstStr = Object.values(a).find((v) => typeof v === 'string' && (v as string).trim());
    if (typeof firstStr === 'string') return clip(firstStr);
  }
  return '';
}
/** 工具内部名 → 用户友好的中文步骤名（未知工具回退原名，避免隐藏信息）。 */
const TOOL_LABEL: Record<string, string> = {
  launch_inspection: '派发检测任务',
  invoke_capability: '调用检测能力',
  retrieve_knowledge: '检索质检知识库',
  get_task_detail: '查询任务详情',
  generate_ppt: '生成汇报文稿',
  submit_final: '提交终判结论',
};
function toolLabel(name?: string): string {
  if (!name) return '工具调用';
  return TOOL_LABEL[name] || name;
}
function pretty(v: any): string {
  try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch { return String(v); }
}

/* 附件选择：隐藏 input + 去重增删，逻辑见 useFilePicker（与首页共用） */
const { inputEl: detFileInput, onChosen: onFiles, removeAt: removeFile, open: openFilePicker } =
  useFilePicker(files, {
    onAdded: (added) => { if (added.length && !isRemote) message.info('文件已添加到本地演示，未上传。', 3.6); },
  });
function pickFiles() {
  /* 主动收起加号菜单：openFilePicker 会唤起原生文件对话框，打断 a-dropdown 的自动收起 */
  plusOpen.value = false;
  openFilePicker();
}

/** 选择检测方向：默认仅标记方向，不写入需求框、不抢焦点（与首页 pickSkill 行为对齐）。
 *  深链 ?capability= 等需要示例预填的场景显式传 prefill: true。 */
function chooseCapability(id: string, opts: { prefill?: boolean } = {}) {
  const c = capabilities.find((x) => x.id === id);
  if (!c) return;
  direction.value = id;
  if (opts.prefill && !prompt.value.trim()) {
    prompt.value = c.prompt;
    void nextTick(() => textareaEl.value?.focus());
  }
}

async function submit() {
  const text = prompt.value.trim();
  if (!text && !files.value.length) {
    message.warning('请描述你的检测需求，或添加图像 / 文件。', 3.2);
    textareaEl.value?.focus();
    return;
  }
  await sendRequest(text, files.value, direction.value);
  prompt.value = '';
  files.value = [];
  await nextTick();
  scrollThreadToBottom(true);
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    void submit();
  }
}

/* ---------- 事件代理:消息 / 空态里的能力按钮 ---------- */
function onDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>('button[data-capability]');
  if (button?.dataset.capability) chooseCapability(button.dataset.capability);
}
onMounted(() => document.addEventListener('click', onDocumentClick));
onUnmounted(() => { document.removeEventListener('click', onDocumentClick); teardownDetection(); });

const homeQuery = computed(() => (dark.value ? { theme: 'dark' as const } : {}));

/** 生成文件预览 URL */
const _urlCache = new WeakMap<File, string>();
function objectUrl(f: File): string {
  let u = _urlCache.get(f);
  if (!u) { u = URL.createObjectURL(f); _urlCache.set(f, u); }
  return u;
}

/* ---------- 等待反馈：回合运行计时 ----------
 * 智能体本回合仍在生成时，线程底部常驻"工作态"条，并用秒表证明它还活着。
 * 后台长任务不驱动这条（改由下方任务舱计时），否则会出现两份秒表互相打架。 */
const busyElapsed = ref(0);
let _tickTimer: ReturnType<typeof setInterval> | undefined;
const elapsedText = computed(() => (busyElapsed.value >= 3 ? `${busyElapsed.value}s` : ''));
watch(agentTurnBusy, (busy) => {
  if (busy) {
    busyElapsed.value = 0;
    if (!_tickTimer) _tickTimer = setInterval(() => { busyElapsed.value += 1; }, 1000);
  } else if (_tickTimer) {
    clearInterval(_tickTimer); _tickTimer = undefined;
  }
});
onUnmounted(() => {
  if (_tickTimer) clearInterval(_tickTimer);
});

/* ---------- 后台任务舱：单一共享时钟 ----------
 * 长时检测任务的实时反馈集中在线程末尾这一处（聊天流里只留一行派发回执）：
 * "正在发生的事落在最新位置"这个阅读直觉成立后，就不会再把流中间的卡片读成卡死。
 * 一个 interval 服务所有 chip，比原先每卡一个计时器更省。 */
const dockNow = ref(Date.now());
let _dockTimer: ReturnType<typeof setInterval> | undefined;
watch(() => runningTaskCards.value.length > 0, (live) => {
  if (live) {
    dockNow.value = Date.now();
    if (!_dockTimer) _dockTimer = setInterval(() => { dockNow.value = Date.now(); }, 1000);
  } else if (_dockTimer) {
    clearInterval(_dockTimer); _dockTimer = undefined;
  }
}, { immediate: true });
onUnmounted(() => { if (_dockTimer) clearInterval(_dockTimer); });

/** 任务已运行时长；超过 1 小时收敛为"1小时+"，避免历史回放算出荒谬数字。 */
function dockElapsed(startedAt: number): string {
  const s = Math.max(0, Math.floor((dockNow.value - startedAt) / 1000));
  if (s >= 3600) return '1小时+';
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}
/** 任务舱行上的任务号尾段（18 位全展开太占地方，完整号在详情弹窗里看）。 */
function shortTaskId(id: string): string {
  return id.length > 10 ? `…${id.slice(-6)}` : id;
}

/** 任务舱行：卡片视图模型 + 阶段进度（详情未到货时为 null）。 */
interface DockRow { taskId: string; scene: string; startedAt: number; progress: StageProgress | null }
const dockRows = computed<DockRow[]>(() =>
  runningTaskCards.value.map((t) => ({ ...t, progress: taskProgress.value[t.taskId] ?? null })));

function fmtTs(ts: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString('zh-CN', { hour12: false });
}
/** 行 tooltip：把"当前在哪一步"追到具体编排节点与时间。 */
function dockRowTitle(r: DockRow): string {
  const base = `查看任务 ${r.taskId} 详情`;
  const ls = r.progress?.lastStep;
  return ls ? `${base} · 最近节点：${nodeLabel(ls.node)} ${fmtTs(ls.ts)}` : base;
}
</script>

<template>
  <div class="detection-layout" :class="{ 'side-collapsed': sidebarCollapsed }">
    <!-- ========== 左侧会话栏 ========== -->
    <aside class="detection-sidebar">
      <div class="det-side-head">
        <div class="det-agent">
          <span class="det-agent-mark">
            <IconSvg name="spark" />
          </span>
          <strong v-show="!sidebarCollapsed">智能视觉助手</strong>
        </div>
        <button class="det-side-toggle" type="button" :aria-label="sidebarCollapsed ? '展开会话栏' : '收起会话栏'"
          @click="sidebarCollapsed = !sidebarCollapsed">
          {{ sidebarCollapsed ? '»' : '«' }}
        </button>
      </div>

      <button class="det-new" type="button" :title="sidebarCollapsed ? '新建对话' : ''" @click="newConversation">
        <span class="det-new-plus">+</span><span v-show="!sidebarCollapsed">新建对话</span>
      </button>

      <template v-if="!sidebarCollapsed">
        <!-- 搜索框 -->
        <div class="det-search">
          <IconSvg name="inspect" class="det-search-icon" />
          <input v-model="searchQuery" type="text" placeholder="搜索会话" />
        </div>

        <!-- 会话列表(按时间分组) -->
        <div class="det-conv-scroll">
          <p v-if="!conversationCount" class="det-conv-empty">{{ isRemote ? '开始一次对话后，会话会保存在服务端。' :
            '开始一次对话后，会话会保存在当前浏览器。' }}</p>
          <template v-else>
            <div v-for="group in groupedConversations" :key="group.label" class="det-conv-group">
              <div class="det-group-label">{{ group.label }}</div>
              <ul class="det-conv-list">
                <li v-for="t in group.list" :key="t.id"
                  :class="{ active: activeId === t.id, renaming: renamingId === t.id }">
                  <input v-if="renamingId === t.id" ref="renameEl" v-model="renameDraft" class="det-conv-input"
                    type="text" :maxlength="60" @blur="commitRename(t.id)" @keydown.enter.prevent="commitRename(t.id)"
                    @keydown.esc.prevent="renamingId = null" />
                  <button v-else class="det-conv-item" type="button" @click="openConversation(t.id)">
                    <span class="det-conv-icon">
                      <IconSvg name="clipboard" />
                    </span>
                    <span class="det-conv-main">
                      <strong>{{ t.title }}</strong>
                      <small>{{ t.sub }}</small>
                    </span>
                  </button>
                  <button v-if="renamingId !== t.id" class="det-conv-rename" type="button" aria-label="重命名会话"
                    title="重命名" @click.stop="startRename(t.id, t.title)">✎</button>
                  <button v-if="renamingId !== t.id" class="det-conv-del" type="button" aria-label="删除会话"
                    @click.stop="removeConversation(t.id)">×</button>
                </li>
              </ul>
            </div>
          </template>
        </div>

        <div class="det-sidebar-bottom">
          <RouterLink :to="{ path: '/', query: { ...homeQuery, module: '任务中心' } }">
            <IconSvg name="clipboard" />查看任务中心
          </RouterLink>
          <RouterLink :to="{ path: '/capabilities', query: homeQuery }">
            <IconSvg name="grid" />浏览专业能力
          </RouterLink>
          <span class="det-sidebar-note">{{ isRemote ? '会话自动保存至云端' : '会话与草稿仅保存在本地' }}</span>
        </div>
      </template>
    </aside>

    <!-- ========== 主区 ========== -->
    <main class="detection-main">
      <div class="det-topline">
        <nav class="breadcrumbs" aria-label="面包屑">
          <RouterLink :to="{ path: '/', query: homeQuery }">首页</RouterLink>
          <span>/</span><strong>智能检测</strong>
        </nav>
        <span class="det-status-badge" :class="{ online: isRemote }">
          <i></i>{{ isRemote ? '助手已连接' : '' }}
        </span>
      </div>

      <div class="det-header">
        <div class="det-header-left">
          <h1>智能视觉助手</h1>
          <span>专业检测 · 需求澄清 · 结果解读</span>
          <span class="det-demo-tag">{{ isRemote ? '真实环境' : '示例界面' }}</span>
        </div>
      </div>

      <!-- 会话线程 -->
      <div v-if="!isStart" class="det-thread-wrap" :class="{ 'has-dock': dockRows.length > 0 }">
        <div ref="threadEl" class="det-thread" @scroll.passive="onThreadScroll">
          <div v-if="error" class="det-error">
            <span>{{ error }}</span>
            <button v-if="isRemote" class="det-error-retry" type="button" :disabled="sending" @click="retryLast">↻
              重试</button>
          </div>
          <template v-for="it in items" :key="it.id">
            <div v-if="it.kind === 'user'" class="det-msg is-user">
              <div class="det-msg-body">
                <p v-if="it.text" class="det-msg-text">{{ it.text }}</p>
                <div v-if="it.images.length" class="det-msg-imgs">
                  <img v-for="(im, i) in splitImages(it.images).images" :key="i" class="det-msg-thumb" :src="im.src"
                    :alt="im.name" :title="im.name" loading="lazy" @click="openMsgImages(it, i)"
                    @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')">
                  <span v-for="(chip, i) in splitImages(it.images).chips" :key="`c${i}`" class="det-msg-file">{{ chip
                    }}</span>
                  <span v-if="!splitImages(it.images).images.length && !splitImages(it.images).chips.length"
                    class="det-msg-file">附件</span>
                </div>
              </div>
            </div>
            <div v-else-if="it.kind === 'assistant'" class="det-msg is-assistant">
              <div class="det-msg-body">
                <div class="det-msg-md">
                  <MarkdownView :text="it.text" /><span v-if="it.streaming" class="det-caret"></span>
                </div>
                <div v-if="it.images.length" class="det-msg-imgs">
                  <img v-for="(im, i) in splitImages(it.images).images" :key="i" class="det-msg-thumb" :src="im.src"
                    :alt="im.name" :title="im.name" loading="lazy" @click="openMsgImages(it, i)"
                    @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')">
                </div>
                <div v-if="!it.streaming && it.text" class="det-msg-actions">
                  <button class="det-msg-act" type="button" @click="copyAnswer(it)">{{ copiedId === it.id ? '✓ 已复制' : '⧉ 复制' }}</button>
                  <button v-if="isRemote && it.id === lastAssistantId" class="det-msg-act" type="button"
                    :disabled="agentBusy" @click="regenerateLast">{{ agentBusy ? '生成中…' : '↻ 重新生成' }}</button>
                </div>
              </div>
            </div>
            <div v-else-if="it.kind === 'thinking'" class="det-thinking" :class="{ 'is-live': it.streaming }">
              <button class="det-thinking-head" type="button" @click="toggleThinking(it)">
                <IconSvg name="spark" /><span>{{ it.streaming ? '正在思考…' : '思考过程' }}</span>
                <span v-if="it.streaming" class="det-caret"></span>
                <span class="det-thinking-toggle">{{ isCollapsed(it) ? '展开' : '收起' }}</span>
              </button>
              <p v-show="!isCollapsed(it)" class="det-thinking-text"
                :ref="(el) => autoScrollThinking(it, el as HTMLElement | null)">{{ it.text }}<span v-if="it.streaming"
                  class="det-caret"></span></p>
            </div>
            <div v-else-if="it.kind === 'chain'" class="det-chain" :class="{ done: it.done, error: it.isError }">
              <button class="det-chain-head" type="button" :aria-expanded="!isCollapsed(it)"
                @click="toggleThinking(it)">
                <span class="det-chain-dot"></span>
                <span v-if="chainStepMap[it.id] && chainStepMap[it.id].total > 1" class="det-chain-step">{{
                  chainStepMap[it.id].no }}</span>
                <span class="det-chain-name">{{ toolLabel(it.name) }}</span>
                <span v-if="chainSummary(it)" class="det-chain-sum">{{ chainSummary(it) }}</span>
                <span v-if="it.done && it.doneAt" class="det-chain-time">{{ ((it.doneAt - it.time) / 1000).toFixed(1)
                  }}s</span>
                <span class="det-chain-state">{{ it.isError ? '失败' : it.done ? '完成' : '执行中' }}</span>
                <span v-if="it.args != null || it.result != null" class="det-chain-toggle">{{ isCollapsed(it) ? '展开' :
                  '收起' }}</span>
              </button>
              <div v-if="it.args != null || it.result != null" v-show="!isCollapsed(it)" class="det-chain-detail">
                <div v-if="it.args != null" class="det-chain-seg">
                  <span class="det-chain-label">调用参数</span>
                  <pre class="det-chain-pre">{{ pretty(it.args) }}</pre>
                </div>
                <div v-if="it.result != null" class="det-chain-seg">
                  <span class="det-chain-label">返回结果</span>
                  <pre class="det-chain-pre">{{ pretty(it.result) }}</pre>
                </div>
              </div>
            </div>
            <DetCardItem v-else-if="it.kind === 'card'" :item="it" />
          </template>

          <!-- 等待反馈：本回合仍在生成（三点条 + 秒表） -->
          <div v-if="agentTurnBusy" class="det-working" role="status" aria-live="polite">
            <span class="det-working-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="det-working-text">{{ agentPhase }}</span>
            <span v-if="elapsedText" class="det-working-elapsed">{{ elapsedText }}</span>
          </div>

          <!-- 后台任务舱：回合已结束、算法仍在跑的任务集中在此（流末尾 = 最新位置）。
               阶段进度由 5s 轮询 GET /tasks/{id} 的 steps 推导，无数据时退化为无步骤条。 -->
          <div v-if="dockRows.length" class="det-taskdock" role="status" aria-live="polite">
            <div class="det-dock-hd">
              <i class="det-dock-pulse" aria-hidden="true"></i>
              后台检测任务 <b>{{ dockRows.length }}</b>
            </div>
            <button v-for="r in dockRows" :key="r.taskId" class="det-dock-row" type="button"
              :title="dockRowTitle(r)" @click="openTaskDetail(r.taskId)">
              <span v-if="r.scene" class="det-dock-scene">{{ sceneCodeToLabel(r.scene) }}</span>
              <code class="det-dock-id">{{ shortTaskId(r.taskId) }}</code>
              <StageStepper v-if="r.progress" :progress="r.progress" dense />
              <!-- 进度到货就画步骤条；真实环境下首次轮询前给一句待定占位，
                   本地演示模式根本不轮询，什么也不画（避免一张永远等不到到货的空占位）。 -->
              <span v-else-if="tasksLive" class="det-dock-loading">进度获取中…</span>
              <span class="det-dock-elapsed">{{ dockElapsed(r.startedAt) }}</span>
              <span class="det-dock-go">详情 →</span>
            </button>
          </div>
        </div>
        <transition name="det-jump">
          <button v-show="showJump" class="det-jump-down" type="button" @click="jumpToBottom">
            <span class="det-jump-arrow" aria-hidden="true">↓</span><span>回到底部</span>
          </button>
        </transition>
      </div>

      <!-- ========== 开始态:英雄区 + 能力卡 + Composer ========== -->
      <template v-else>
        <section class="det-hero">
          <div class="det-hero-icon">
            <IconSvg name="spark" />
          </div>
          <h2>这次，你想检测什么？</h2>
          <p>描述检测目标，或选择专业方向开始分析。</p>
        </section>

        <!-- 能力卡网格 -->
        <section class="det-cap-section">
          <div class="det-cap-toolbar">
            <span class="det-cap-toolbar-label">选择检测方向</span>
            <label class="det-auto-toggle">
              <input type="radio" :checked="direction === 'auto'" @change="direction = 'auto'" />
              <span>自动识别方向</span>
              <IconSvg name="inspect" class="det-auto-info" />
            </label>
          </div>
          <div class="det-cards">
            <button v-for="c in capabilities" :key="c.id" class="det-cap-card" :class="{ active: direction === c.id }"
              type="button" @click="chooseCapability(c.id)">
              <span class="det-cap-icon" :style="{ background: c.bg, color: c.color }">
                <IconSvg :name="c.icon" />
              </span>
              <span class="det-cap-text">
                <strong>{{ c.name }}</strong>
                <small>{{ c.desc }}</small>
              </span>
              <span class="det-cap-arrow" v-if="direction === c.id">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" fill="#2368e4" />
                  <path d="m8 12 3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round" />
                </svg>
              </span>
              <span class="det-cap-arrow" v-else>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </span>
            </button>
          </div>
        </section>

        <!-- Composer 区域 -->
        <section class="det-composer-section">
          <div class="det-composer-header">
            <span class="det-composer-title">
              <IconSvg name="spark" /> 检测需求
            </span>
            <span v-if="selectedCap" class="det-dir-tag" :style="{ borderColor: selectedCap.color }">
              检测方向:
              <span class="det-dir-tag-icon" :style="{ background: selectedCap.bg, color: selectedCap.color }">
                <IconSvg :name="selectedCap.icon" />
              </span>
              {{ selectedCap.name }}
              <button type="button" @click="direction = 'auto'">×</button>
            </span>
          </div>
          <div class="det-composer">
            <textarea ref="textareaEl" v-model="prompt" class="det-textarea" :maxlength="3000" rows="3"
              placeholder="请分析这组热部试验图像，标记疑似异常区域，并汇总检测结果。" @keydown="onKeydown"></textarea>
            <!-- 快捷建议 chips -->
            <div class="det-suggestions">
              <button v-for="s in suggestions" :key="s" class="det-sug-chip" type="button"
                @click="prompt = s + '；' + prompt">
                <IconSvg name="spark" />{{ s }}
              </button>
            </div>
            <!-- 文件缩略图 -->
            <div v-if="files.length" class="det-file-thumbs">
              <div v-for="(f, i) in files" :key="`${f.name}-${i}`" class="det-thumb">
                <div class="det-thumb-preview">
                  <img v-if="f.type.startsWith('image/')" :src="objectUrl(f)" :alt="f.name" />
                  <IconSvg v-else name="box" />
                </div>
                <div class="det-thumb-info">
                  <strong>{{ f.name }}</strong>
                  <small>{{ formatSizeKB(f.size) }}</small>
                </div>
                <button class="det-thumb-del" type="button" @click="removeFile(i)">×</button>
              </div>
              <button class="det-thumb-add" type="button" @click="pickFiles">
                <span>+</span>添加图像
              </button>
            </div>
            <!-- 底部栏：左下加号菜单、右下模型切换 + 发送 -->
            <div class="composer-toolbar det-composer-toolbar">
              <div class="toolbar-left">
                <a-dropdown v-model:open="plusOpen" :trigger="['click']" placement="topLeft"
                  overlay-class-name="assistant-menu">
                  <button class="tool-plus" type="button" aria-label="添加文件与技能">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                  <template #overlay>
                    <a-menu>
                      <a-menu-item key="file" @click="pickFiles">
                        <IconSvg name="paperclip" /><span>添加文件</span>
                      </a-menu-item>
                      <a-menu-item-group title="选择检测方向">
                        <a-menu-item v-for="c in capabilities" :key="`sk-${c.id}`" @click="pickDirection(c.id)">
                          <IconSvg :name="c.icon" /><span>{{ c.name }}</span>
                          <svg v-if="direction === c.id" class="assistant-menu-check" viewBox="0 0 24 24"
                            aria-hidden="true">
                            <path d="m5 12 5 5 9-11" />
                          </svg>
                        </a-menu-item>
                      </a-menu-item-group>
                    </a-menu>
                  </template>
                </a-dropdown>
                <span v-if="files.length" class="det-file-count">已添加 {{ files.length }} 个文件</span>
              </div>
              <div class="toolbar-right">
                <ModelPicker />
                <span class="char-count">{{ prompt.length }}/3000</span>
                <SendButton :loading="sending" :disabled="sending" @click="submit" />
              </div>
            </div>
          </div>
        </section>

        <!-- 底部工作流步骤 -->
        <div class="det-workflow">
          <div class="det-wf-step">
            <IconSvg name="clipboard" /><span>需求确认</span>
          </div>
          <span class="det-wf-arrow">→</span>
          <div class="det-wf-step">
            <IconSvg name="inspect" /><span>专业检测</span>
          </div>
          <span class="det-wf-arrow">→</span>
          <div class="det-wf-step">
            <IconSvg name="book" /><span>结果解读</span>
          </div>
          <span class="det-wf-arrow">→</span>
          <div class="det-wf-step">
            <IconSvg name="report" /><span>报告生成</span>
          </div>
        </div>
        <p class="det-footnote">检测结果与报告草稿需人工复核。</p>
      </template>

      <!-- 有会话时的 Composer 区 -->
      <div v-if="!isStart" class="det-composer-wrap">
        <div class="det-dir-chips" role="group" aria-label="选择专业方向">
          <button v-for="o in directionChips" :key="o.value" class="det-dir-chip" :class="{ on: direction === o.value }"
            type="button" @click="direction = o.value">{{ o.label }}</button>
        </div>
        <div class="det-composer">
          <textarea ref="textareaEl" v-model="prompt" class="det-textarea" :maxlength="3000" rows="2"
            placeholder="描述检测需求，例如：分析这组孔探图像，定位叶片损伤，并准备检测报告…" @keydown="onKeydown"></textarea>
          <div v-if="files.length" class="det-files">
            <span v-for="(f, i) in files" :key="`${f.name}-${i}`" class="det-file-chip">
              {{ f.name }} · {{ formatSizeKB(f.size) }}
              <button type="button" aria-label="移除文件" @click="removeFile(i)">×</button>
            </span>
          </div>
          <div class="composer-toolbar det-composer-toolbar">
            <div class="toolbar-left">
              <a-dropdown v-model:open="plusOpen" :trigger="['click']" placement="topLeft"
                overlay-class-name="assistant-menu">
                <button class="tool-plus" type="button" aria-label="添加文件与技能">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <template #overlay>
                  <a-menu>
                    <a-menu-item key="file" @click="pickFiles">
                      <IconSvg name="paperclip" /><span>添加文件</span>
                    </a-menu-item>
                    <a-menu-item-group title="选择检测方向">
                      <a-menu-item v-for="c in capabilities" :key="`sk-${c.id}`" @click="pickDirection(c.id)">
                        <IconSvg :name="c.icon" /><span>{{ c.name }}</span>
                        <svg v-if="direction === c.id" class="assistant-menu-check" viewBox="0 0 24 24"
                          aria-hidden="true">
                          <path d="m5 12 5 5 9-11" />
                        </svg>
                      </a-menu-item>
                    </a-menu-item-group>
                  </a-menu>
                </template>
              </a-dropdown>
            </div>
            <div class="toolbar-right">
              <ModelPicker />
              <span class="char-count">{{ prompt.length }}/3000</span>
              <SendButton :loading="sending" :disabled="sending" @click="submit" />
            </div>
          </div>
        </div>
        <p class="det-footnote">{{ isRemote ? '需求由智能视觉助手理解并派发检测任务；专业结论需人工复核。' : '当前仅演示需求理解与工具选择，不执行检测；专业结论需人工复核。' }}</p>
      </div>
      <input ref="detFileInput" type="file" multiple hidden @change="onFiles">
    </main>

    <!-- 任务详情弹窗（卡片点击就地查看） -->
    <TaskDetailModal />
  </div>
</template>
