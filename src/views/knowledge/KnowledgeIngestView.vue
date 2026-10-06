<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  activeKbId, connection, datasets, docs, docImageUrl, docPreviewUrl, downloadDoc, ensureLoaded,
  fetchDocChunks, goTab, kbName, loadDocs, parseDoc, remote, uploadDocs,
} from '@/composables/use-knowledge';
import type { IngestDoc } from '@/data/knowledge';

const uploading = ref(false);
const refreshing = ref(false);
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const search = ref('');
const statusFilter = ref<StatusGroup | 'all'>('all');
const typeFilter = ref('all');
const page = ref(1);
const pageSize = ref(10);
const selectedId = ref('');

onMounted(() => { ensureLoaded(); });

/* ---------- 状态归组与展示映射 ---------- */
type StatusGroup = 'ready' | 'processing' | 'pending';
const groupOf = (s: IngestDoc['status']): StatusGroup =>
  s === '已解析' ? 'ready' : s === '待入库' ? 'pending' : 'processing';

const STATUS_VIEW: Record<IngestDoc['status'], { label: string; tone: string }> = {
  已解析: { label: '可检索', tone: 'green' },
  索引中: { label: '索引中', tone: 'blue' },
  解析中: { label: '解析中', tone: 'amber' },
  待入库: { label: '待入库', tone: 'gray' },
};
const isProcessing = (d: IngestDoc) => groupOf(d.status) === 'processing';

/* ---------- 统计卡 ---------- */
const stats = computed(() => {
  const all = docs.value;
  return {
    total: all.length,
    ready: all.filter((d) => groupOf(d.status) === 'ready').length,
    processing: all.filter((d) => groupOf(d.status) === 'processing').length,
    pending: all.filter((d) => groupOf(d.status) === 'pending').length,
  };
});

/* ---------- 类型筛选项 ---------- */
const typeOptions = computed(() => {
  const set = Array.from(new Set(docs.value.map((d) => d.type).filter(Boolean)));
  return set.map((t) => ({ value: t, label: t }));
});

/* ---------- 过滤 + 分页 ---------- */
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return docs.value.filter((d) => {
    if (statusFilter.value !== 'all' && groupOf(d.status) !== statusFilter.value) return false;
    if (typeFilter.value !== 'all' && d.type !== typeFilter.value) return false;
    if (q && !d.name.toLowerCase().includes(q)) return false;
    return true;
  });
});
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filtered.value.slice(start, start + pageSize.value);
});
watch([filtered, pageSize], () => {
  if (page.value > totalPages.value) page.value = totalPages.value;
});
watch([search, statusFilter, typeFilter], () => { page.value = 1; });

const pageNumbers = computed(() =>
  Array.from({ length: totalPages.value }, (_, i) => i + 1).slice(0, 7),
);

/* ---------- 选中详情 ---------- */
const selected = computed<IngestDoc | null>(
  () => docs.value.find((d) => d.id === selectedId.value) ?? filtered.value[0] ?? docs.value[0] ?? null,
);
function selectDoc(d: IngestDoc) { selectedId.value = d.id; }

const STEP_META = [
  { title: '已上传', desc: '文件已接收' },
  { title: '文本解析', desc: '内容解析完成' },
  { title: '内容索引', desc: '正在建立检索索引' },
  { title: '可检索', desc: '资料可用于检索与引用' },
];
const DONE_COUNT: Record<IngestDoc['status'], number> = { 待入库: 1, 解析中: 1, 索引中: 2, 已解析: 4 };
const ACTIVE_STEP: Partial<Record<IngestDoc['status'], number>> = { 解析中: 1, 索引中: 2 };
const steps = computed(() => {
  const st = selected.value?.status ?? '待入库';
  const done = DONE_COUNT[st];
  const active = ACTIVE_STEP[st] ?? -1;
  return STEP_META.map((m, i) => ({
    ...m,
    state: (i < done ? 'done' : i === active ? 'active' : 'pending') as 'done' | 'active' | 'pending',
  }));
});
const detailStatus = computed(() => (selected.value ? STATUS_VIEW[selected.value.status] : null));

/* ---------- 文件类型徽标 ---------- */
function typeKind(t: string): 'pdf' | 'word' | 'md' | 'file' {
  const u = (t || '').toUpperCase();
  if (u.includes('PDF')) return 'pdf';
  if (u.includes('DOC') || u === 'WORD') return 'word';
  if (u.includes('MD') || u.includes('MARK')) return 'md';
  return 'file';
}
const typeMark: Record<string, string> = { pdf: 'PDF', word: 'W', md: 'M', file: 'F' };
const subtitleOf = (d: IngestDoc) => d.category || (remote ? kbName.value : '知识库资料');

/* ---------- 交互 ---------- */
function openPicker() { fileInput.value?.click(); }

async function ingestFiles(list: FileList | File[] | null) {
  const chosen = Array.from(list ?? []).filter(Boolean);
  if (!chosen.length) return;
  uploading.value = true;
  await uploadDocs(chosen);
  uploading.value = false;
}
function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  void ingestFiles(input.files);
  input.value = '';
}
function onDrop(e: DragEvent) {
  dragOver.value = false;
  void ingestFiles(e.dataTransfer?.files ?? null);
}

async function refresh() {
  refreshing.value = true;
  await loadDocs();
  refreshing.value = false;
  message.success('资料列表已刷新', 2);
}

async function onKbChange() {
  page.value = 1;
  selectedId.value = '';
  await loadDocs();
}

async function startIngest(d: IngestDoc) {
  selectDoc(d);
  await parseDoc(d.id);
  if (!remote) message.success(`「${d.name}」已推进入库流程（演示）`, 2.4);
}

const modeLabel = computed(() => {
  if (!remote) return '演示模式';
  if (connection.status === 'error') return '后端异常 · 已回退演示';
  return '已连接知识库';
});
const modeErr = computed(() => remote && connection.status === 'error');

/* ---------- 原文预览 / 下载 ---------- */
const previewing = ref(false);
const previewDoc = ref<IngestDoc | null>(null);
const previewChunks = ref<{ chunkId: string; content: string; imageId: string }[]>([]);
const loadingChunks = ref(false);
const previewHint = ref('');

const inlineKind = computed<'pdf' | 'image' | 'none'>(() => {
  const d = previewDoc.value;
  if (!d) return 'none';
  const n = (d.name || '').toLowerCase();
  const u = (d.type || '').toUpperCase();
  if (u.includes('PDF') || n.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return 'image';
  return 'none';
});

async function openPreview(d: IngestDoc) {
  selectDoc(d);
  previewDoc.value = d;
  previewing.value = true;
  previewChunks.value = [];
  previewHint.value = '';
  if (!remote) { previewHint.value = '演示模式：无原始文档，接入后端后可预览与下载。'; return; }
  loadingChunks.value = true;
  try {
    previewChunks.value = await fetchDocChunks(d);
  } catch {
    previewHint.value = '原文预览端点尚未部署到服务器（需更新 ragflow.py 并重启后重试）。';
  } finally {
    loadingChunks.value = false;
  }
}
function closePreview() { previewing.value = false; }
async function doDownload() { if (previewDoc.value) await downloadDoc(previewDoc.value); }
function onChunkImgError(e: Event) { (e.target as HTMLImageElement).style.display = 'none'; }
</script>

<template>
  <div class="kin">
    <!-- 顶部操作条 -->
    <div class="kin-bar">
      <span class="kin-mode" :class="{ err: modeErr }">
        <i class="kin-dot"></i>{{ modeLabel }}
      </span>
      <div class="kin-bar-actions">
        <button type="button" class="kin-btn" :disabled="refreshing" @click="refresh">
          <svg viewBox="0 0 24 24" :class="{ spin: refreshing }" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
          </svg>
          {{ refreshing ? '刷新中…' : '刷新' }}
        </button>
        <button type="button" class="kin-btn kin-btn-primary" :disabled="uploading" @click="openPicker">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {{ uploading ? '上传中…' : '添加本地资料' }}
        </button>
      </div>
    </div>

    <!-- 统计卡 -->
    <div class="kin-stats">
      <div class="kin-stat">
        <span class="kin-stat-ico i-blue">
          <svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
        </span>
        <div class="kin-stat-body">
          <small>资料总数</small><b>{{ stats.total }}</b><em>当前资料范围</em>
        </div>
      </div>
      <div class="kin-stat">
        <span class="kin-stat-ico i-green">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
        </span>
        <div class="kin-stat-body">
          <small>可检索</small><b>{{ stats.ready }}</b><em>已完成解析与索引</em>
        </div>
      </div>
      <div class="kin-stat">
        <span class="kin-stat-ico i-cyan">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2m10-10 2-2" /></svg>
        </span>
        <div class="kin-stat-body">
          <small>处理中</small><b>{{ stats.processing }}</b><em>正在建立内容索引</em>
        </div>
      </div>
      <div class="kin-stat">
        <span class="kin-stat-ico i-amber">
          <svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L8 8m4-4 4 4" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
        </span>
        <div class="kin-stat-body">
          <small>待入库</small><b>{{ stats.pending }}</b><em>等待启动处理</em>
        </div>
      </div>
    </div>

    <!-- 拖拽上传区 -->
    <div
      class="kin-drop"
      :class="{ over: dragOver, busy: uploading }"
      @click="openPicker"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <span class="kin-drop-ico">
        <svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9.5a3.5 3.5 0 0 1 .5 6.96" /><path d="M12 13v7m0-7-2.5 2.5M12 13l2.5 2.5" /></svg>
      </span>
      <div class="kin-drop-text">
        <strong>拖拽资料至此，或<span>点击选择文件</span></strong>
        <small>支持 PDF、Word、Markdown</small>
      </div>
      <button type="button" class="kin-btn" @click.stop="openPicker">选择文件</button>
      <input ref="fileInput" type="file" multiple hidden :disabled="uploading" @change="onFileChange" />
    </div>

    <!-- 主体：列表 + 详情 -->
    <div class="kin-grid">
      <section class="kin-list">
        <div class="kin-list-head">
          <h3>资料列表</h3>
          <div class="kin-pills">
            <button type="button" class="p-all" :class="{ on: statusFilter === 'all' }" @click="statusFilter = 'all'">全部 <b>{{ stats.total }}</b></button>
            <button type="button" class="p-green" :class="{ on: statusFilter === 'ready' }" @click="statusFilter = 'ready'">可检索 <b>{{ stats.ready }}</b></button>
            <button type="button" class="p-blue" :class="{ on: statusFilter === 'processing' }" @click="statusFilter = 'processing'">处理中 <b>{{ stats.processing }}</b></button>
            <button type="button" class="p-amber" :class="{ on: statusFilter === 'pending' }" @click="statusFilter = 'pending'">待入库 <b>{{ stats.pending }}</b></button>
          </div>
          <div class="kin-filters">
            <select v-model="activeKbId" class="kin-select" aria-label="知识库" @change="onKbChange">
              <option v-for="k in datasets" :key="k.id" :value="k.id">{{ k.name }}（{{ k.docs }}）</option>
            </select>
            <label class="kin-search">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
              <input v-model="search" placeholder="搜索资料名称" />
            </label>
            <select v-model="statusFilter" class="kin-select" aria-label="状态筛选">
              <option value="all">状态：全部</option>
              <option value="ready">可检索</option>
              <option value="processing">处理中</option>
              <option value="pending">待入库</option>
            </select>
            <select v-model="typeFilter" class="kin-select" aria-label="类型筛选">
              <option value="all">类型：全部</option>
              <option v-for="t in typeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
        </div>

        <div class="kin-table-wrap">
          <table class="kin-table">
            <thead>
              <tr>
                <th>资料名称</th>
                <th class="w-type">类型 / 大小</th>
                <th class="w-status">入库状态</th>
                <th class="w-time">更新时间</th>
                <th class="w-act">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="d in paged"
                :key="d.id"
                :class="{ active: d.id === selected?.id }"
                @click="selectDoc(d)"
              >
                <td>
                  <div class="kin-td-name">
                    <span class="kin-file" :class="'k-' + typeKind(d.type)">{{ typeMark[typeKind(d.type)] }}</span>
                    <div class="kin-name-main">
                      <strong>{{ d.name }}</strong>
                      <small>{{ subtitleOf(d) }}</small>
                    </div>
                  </div>
                </td>
                <td class="kin-td-type">{{ d.type }} · {{ d.size }}</td>
                <td>
                  <div class="kin-td-status">
                    <span class="task-tag" :class="'tone-' + STATUS_VIEW[d.status].tone">{{ STATUS_VIEW[d.status].label }}</span>
                    <span v-if="isProcessing(d)" class="kin-prog"><i></i></span>
                  </div>
                </td>
                <td class="kin-td-time">{{ d.updatedAt }}</td>
                <td class="kin-td-act">
                  <button
                    v-if="groupOf(d.status) === 'pending'"
                    type="button"
                    class="kin-start"
                    @click.stop="startIngest(d)"
                  >开始入库</button>
                  <button
                    v-else
                    type="button"
                    class="kin-link"
                    @click.stop="isProcessing(d) ? selectDoc(d) : openPreview(d)"
                  >{{ isProcessing(d) ? '查看进度' : '查看资料' }}</button>
                </td>
              </tr>
              <tr v-if="!paged.length">
                <td class="kin-td-empty" colspan="5">没有符合条件的资料</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="kin-pager">
          <span class="kin-pager-info">共 {{ filtered.length }} 条资料</span>
          <div class="kin-pager-ctrl">
            <select v-model.number="pageSize" class="kin-select kin-page-size" aria-label="每页条数">
              <option :value="10">每页 10 条</option>
              <option :value="20">每页 20 条</option>
              <option :value="50">每页 50 条</option>
            </select>
            <button type="button" class="kin-page" :disabled="page <= 1" @click="page -= 1">‹</button>
            <button
              v-for="n in pageNumbers"
              :key="n"
              type="button"
              class="kin-page"
              :class="{ on: n === page }"
              @click="page = n"
            >{{ n }}</button>
            <button type="button" class="kin-page" :disabled="page >= totalPages" @click="page += 1">›</button>
          </div>
        </div>
      </section>

      <!-- 入库详情 -->
      <aside class="kin-detail">
        <template v-if="selected">
          <div class="kin-detail-head">
            <h3>入库详情</h3>
            <span v-if="detailStatus" class="task-tag" :class="'tone-' + detailStatus.tone">{{ detailStatus.label }}</span>
          </div>

          <div class="kin-detail-file">
            <span class="kin-file lg" :class="'k-' + typeKind(selected.type)">{{ typeMark[typeKind(selected.type)] }}</span>
            <div class="kin-detail-name">
              <strong>{{ selected.name }}</strong>
              <small>{{ subtitleOf(selected) }}</small>
            </div>
          </div>

          <div class="kin-detail-meta">
            <div><small>文件类型</small><b>{{ selected.type }}</b></div>
            <div><small>文件大小</small><b>{{ selected.size }}</b></div>
          </div>

          <ol class="kin-steps">
            <li v-for="(s, i) in steps" :key="i" :class="s.state">
              <span class="kin-step-node">
                <svg v-if="s.state === 'done'" viewBox="0 0 24 24"><path d="m5 12 4 4 10-10" /></svg>
                <svg v-else-if="s.state === 'active'" viewBox="0 0 24 24" class="spin"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
              </span>
              <div class="kin-step-body">
                <strong>{{ s.title }}</strong>
                <small>{{ s.desc }}</small>
                <span v-if="s.state === 'active'" class="kin-prog wide"><i></i></span>
              </div>
            </li>
          </ol>

          <p class="kin-detail-note">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8v.01" /></svg>
            <span v-if="groupOf(selected.status) === 'pending'">资料已上传，点击「开始入库」启动文本解析与索引。</span>
            <span v-else-if="isProcessing(selected)">文本解析完成后，仍需建立索引才能检索。</span>
            <span v-else>索引已完成，该资料可在「检索与引用」中被召回。</span>
          </p>

          <div v-if="groupOf(selected.status) === 'ready'" class="kin-detail-acts">
            <button type="button" class="kin-btn kin-btn-primary" @click="openPreview(selected)">查看原文</button>
            <button type="button" class="kin-btn" @click="downloadDoc(selected)">下载</button>
          </div>

          <button type="button" class="kin-detail-link" @click="goTab('search')">
            前往检索与引用验证 →
          </button>
        </template>
        <div v-else class="kin-detail-empty">
          <svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
          <p>选择左侧资料查看入库进度</p>
        </div>
      </aside>
    </div>

    <p class="kin-footnote">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8v.01" /></svg>
      资料入库流程：待入库 → 文本解析 → 内容索引 → 可检索 ｜ 完成索引后，资料可用于检索与引用。
    </p>

    <!-- 原文预览弹窗 -->
    <div v-if="previewing" class="kin-modal" @click.self="closePreview">
      <div class="kin-modal-panel">
        <header class="kin-modal-head">
          <span class="kin-file" :class="'k-' + typeKind(previewDoc?.type || '')">{{ typeMark[typeKind(previewDoc?.type || '')] }}</span>
          <strong class="kin-modal-title">{{ previewDoc?.name }}</strong>
          <div class="kin-modal-acts">
            <button type="button" class="kin-btn" @click="doDownload">下载原文</button>
            <button type="button" class="kin-modal-x" aria-label="关闭" @click="closePreview">×</button>
          </div>
        </header>
        <div class="kin-modal-body">
          <iframe v-if="inlineKind === 'pdf' && previewDoc" :src="docPreviewUrl(previewDoc)" class="kin-modal-frame" title="原文预览" />
          <div v-else-if="inlineKind === 'image' && previewDoc" class="kin-modal-img">
            <img :src="docPreviewUrl(previewDoc)" :alt="previewDoc.name" />
          </div>
          <div v-else class="kin-modal-text">
            <p v-if="loadingChunks" class="kin-modal-tip">解析文本加载中…</p>
            <p v-else-if="previewHint" class="kin-modal-tip">{{ previewHint }}</p>
            <template v-else>
              <div v-for="(c, i) in previewChunks" :key="c.chunkId || i" class="kin-chunk">
                <p class="kin-chunk-text">{{ c.content }}</p>
                <img
                  v-if="c.imageId"
                  class="kin-chunk-img"
                  :src="docImageUrl(c.imageId)"
                  :alt="`图 ${i + 1}`"
                  loading="lazy"
                  @error="onChunkImgError"
                />
              </div>
              <p v-if="!previewChunks.length" class="kin-modal-tip">该资料暂无可预览的解析文本，可尝试下载原始文件。</p>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
