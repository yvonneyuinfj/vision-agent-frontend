<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import IconSvg from '@/components/IconSvg.vue';
import { setTheme, useTheme, activeNav } from '@/composables/use-theme';
import {
  prodMode, units, setMode, runProbe, probeAll, fetchPlatformHealth,
  type PlatformHealth, type ApiUnit,
} from '@/api/source-registry';

const route = useRoute();
const theme = useTheme();
const dark = computed(() => theme.value === 'dark');
setTheme(route.query.theme === 'dark' ? 'dark' : 'light');

const health = ref<PlatformHealth | null>(null);
const healthLoading = ref(false);
const probingAll = ref(false);
const rowBusy = reactive<Record<string, boolean>>({});

const homeQuery = computed(() => (dark.value ? { theme: 'dark' as const } : {}));

/* ---------------- 健康卡 ---------------- */
const ICONS = {
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  book: '<path d="M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z"/>',
};
type Tone = 'ok' | 'warn' | 'bad' | 'idle';
const TAG_TEXT: Record<Tone, string> = { ok: '正常', warn: '降级', bad: '异常', idle: '未知' };
const TAG_CLASS: Record<Tone, string> = { ok: 'tone-green', warn: 'tone-amber', bad: 'tone-red', idle: 'tone-gray' };
function dbOk(v: string) { return v === 'ok' || v === 'connected' || v === 'healthy'; }
/** 方言名 → 展示用产品名 */
const DB_NAME: Record<string, string> = { mysql: 'MySQL', mariadb: 'MariaDB', sqlite: 'SQLite', postgresql: 'PostgreSQL', postgres: 'PostgreSQL' };

const healthCards = computed(() => {
  const h = health.value;
  const svcOk = !!h && h.status === 'healthy';
  const dOk = !!h && dbOk(h.database);
  // 型号明细：新后端逐行展示 VLM/LLM；旧后端未下发字段时给出可行动提示而非误标「未配置」
  const modelLines = h && h.modelReported
    ? [
        { k: 'VLM', v: h.vlmModel || '未配置' },
        { k: 'LLM', v: h.llmModel ? `${h.llmModel}${h.llmProvider ? ` · ${h.llmProvider}` : ''}` : '未配置' },
      ]
    : undefined;
  const modelNote = h
    ? h.modelReported
      ? `${h.vlmModel || '未配置'} · LLM ${h.llmModel || '未配置'}`
      : h.vlmAvailable ? '后端未上报型号 · 需升级 quality-agent' : 'VLM 不可用'
    : '加载中…';
  const modelTitle = h && h.modelReported
    ? `VLM ${h.vlmModel || '未配置'}｜LLM ${h.llmModel || '未配置'}${h.llmProvider ? `｜协议 ${h.llmProvider}` : ''}`
    : modelNote;
  // 平台/数据库/RAGFlow 版本明细：后端下发了才展示行，旧后端保持原 note
  const dbLabel = h && h.dbProduct ? `${DB_NAME[h.dbProduct] ?? h.dbProduct}${h.dbVersion ? ` ${h.dbVersion}` : ''}` : '';
  const svcLines = h?.platformVersion ? [{ k: '版本', v: `v${h.platformVersion}` }] : undefined;
  const dbLines = dbLabel ? [{ k: '选型', v: dbLabel }] : undefined;
  const rfLines = h && h.ragflowVersion
    ? [{ k: '版本', v: h.ragflowVersion }, { k: '文档', v: `${h.ragflowDocCount} 篇` }]
    : undefined;
  return [
    {
      label: '后端服务', value: !h ? '—' : svcOk ? '在线' : h.status === '—' ? '未知' : '降级',
      note: !h ? '加载中…' : (h.error || '存活探测通过'), lines: svcLines,
      title: svcLines ? `平台版本 v${h!.platformVersion}` : undefined,
      tone: (!h ? 'idle' : svcOk ? 'ok' : 'bad') as Tone,
      icon: ICONS.server, color: '#1f8a4c', bg: '#e7f7ec',
    },
    {
      label: '数据库', value: !h ? '—' : dOk ? '已连接' : h.database,
      note: !h ? '加载中…' : `最近检查 ${fmtTime(Date.now())}`, lines: dbLines,
      title: dbLabel ? `${dbLabel}｜最近检查 ${fmtTime(Date.now())}` : undefined,
      tone: (!h ? 'idle' : dOk ? 'ok' : 'warn') as Tone,
      icon: ICONS.database, color: '#2368c9', bg: '#e9f2ff',
    },
    {
      label: '推理模型 VLM / LLM', value: !h ? '—' : h.vlmAvailable ? '可达' : '不可用',
      note: !h ? '加载中…' : modelNote, lines: modelLines, title: modelTitle,
      tone: (!h ? 'idle' : h.vlmAvailable ? 'ok' : 'warn') as Tone,
      icon: ICONS.cpu, color: '#7562c9', bg: '#f0eaff',
    },
    {
      label: '知识服务 RAGFlow', value: !h ? '—' : h.ragflowError && !h.ragflowReachable ? '探测失败' : h.ragflowReachable ? '可达' : h.ragflowConfigured ? '不可达' : '未配置',
      note: !h ? '加载中…' : (h.ragflowError && !h.ragflowReachable ? h.ragflowError : `知识库 ${h.ragflowDocCount} 篇文档`), lines: rfLines,
      title: h?.ragflowVersion ? `RAGFlow ${h.ragflowVersion}｜知识库 ${h.ragflowDocCount} 篇文档` : undefined,
      tone: (!h ? 'idle' : h.ragflowError && !h.ragflowReachable ? 'warn' : h.ragflowReachable ? 'ok' : h.ragflowConfigured ? 'bad' : 'idle') as Tone,
      icon: ICONS.book, color: '#d1701f', bg: '#fdf3e2',
    },
  ];
});

/* ---------------- 清单过滤 / 分页 ---------------- */
type FilterKey = 'all' | 'ok' | 'fail' | 'unknown';
const filter = ref<FilterKey>('all');
const keyword = ref('');
const moduleFilter = ref('all');

const counts = computed(() => {
  const c = { all: units.list.length, ok: 0, fail: 0, unknown: 0 };
  for (const u of units.list) {
    if (u.result.status === 'ok') c.ok++;
    else if (u.result.status === 'fail') c.fail++;
    else c.unknown++;
  }
  return c;
});
const filterTabs = computed(() => [
  { key: 'all' as FilterKey, label: '全部', count: counts.value.all },
  { key: 'ok' as FilterKey, label: '正常', count: counts.value.ok },
  { key: 'fail' as FilterKey, label: '异常', count: counts.value.fail },
  { key: 'unknown' as FilterKey, label: '未检测', count: counts.value.unknown },
]);
const moduleOptions = computed(() => [
  { value: 'all', label: '全部' },
  ...Array.from(new Set(units.list.map((u) => u.group))).map((g) => ({ value: g, label: g })),
]);

function matchFilter(u: ApiUnit): boolean {
  if (filter.value === 'ok') return u.result.status === 'ok';
  if (filter.value === 'fail') return u.result.status === 'fail';
  if (filter.value === 'unknown') return u.result.status !== 'ok' && u.result.status !== 'fail';
  return true;
}
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return units.list.filter((u) =>
    matchFilter(u) &&
    (moduleFilter.value === 'all' || u.group === moduleFilter.value) &&
    (!kw || (u.label + u.path).toLowerCase().includes(kw)));
});

const columns = [
  { title: '所属模块', dataIndex: 'group', key: 'group', width: 96 },
  { title: '接口名称', dataIndex: 'label', key: 'label', width: 110 },
  { title: '请求方式', key: 'method', width: 84 },
  { title: '请求路径', key: 'path', ellipsis: true },
  { title: '数据源', key: 'mode', width: 92 },
  { title: '探测结果', key: 'probe', width: 92 },
  { title: '响应耗时', key: 'latency', width: 132 },
  { title: '最近检测', key: 'time', width: 100 },
  { title: '操作', key: 'action', width: 72 },
];

const pagination = computed(() => ({
  pageSize: 8,
  size: 'small',
  showSizeChanger: true,
  pageSizeOptions: ['8', '15', '30'],
  showTotal: (t: number) => `共 ${t} 条`,
}));

/* ---------------- 工具函数 ---------------- */
function statusText(s: ApiUnit['result']['status']): string {
  return s === 'ok' ? '正常' : s === 'fail' ? '异常' : s === 'checking' ? '探测中' : '未检测';
}
function statusClass(s: ApiUnit['result']['status']): string {
  return s === 'ok' ? 'tone-green' : s === 'fail' ? 'tone-red' : s === 'checking' ? 'tone-blue' : 'tone-gray';
}
function methodClass(m: string): string {
  return m === 'GET' ? 'tone-blue' : m === 'POST' ? 'tone-amber' : 'tone-gray';
}
function latPct(ms: number | null): number {
  if (!ms || ms < 0) return 0;
  return Math.max(6, Math.min(100, Math.round((ms / 250) * 100)));
}
function fmtTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ---------------- 交互 ---------------- */
async function loadHealth() {
  healthLoading.value = true;
  health.value = await fetchPlatformHealth();
  healthLoading.value = false;
}
async function onProbe(u: ApiUnit) {
  rowBusy[u.key] = true;
  await runProbe(u.key);
  rowBusy[u.key] = false;
}
async function onProbeAll() {
  probingAll.value = true;
  await probeAll();
  await loadHealth();
  probingAll.value = false;
}
function onToggle(u: ApiUnit, live: boolean) {
  setMode(u.key, live);
  if (live) void onProbe(u);
}
function notReady(name: string) {
  message.info(`${name}：模块开发中，敬请期待。`, 2.4);
}

onMounted(() => {
  activeNav.value = '后台管理';
  void loadHealth();
  void onProbeAll();
});
</script>

<template>
  <div class="center-layout">
    <!-- 侧栏 -->
    <aside class="catalog-sidebar">
      <RouterLink class="back-home" :to="{ path: '/', query: homeQuery }">
        <IconSvg name="home" /><span>返回首页</span>
      </RouterLink>
      <div class="catalog-label">后台管理</div>
      <nav class="category-nav">
        <a class="selected"><IconSvg name="scan" /><span>接口监控</span></a>
        <a @click="notReady('服务配置')"><IconSvg name="settings" /><span>服务配置</span></a>
        <a @click="notReady('用户与权限')"><IconSvg name="user" /><span>用户与权限</span></a>
        <a @click="notReady('操作日志')"><IconSvg name="clipboard" /><span>操作日志</span></a>
      </nav>
    </aside>

    <!-- 主区 -->
    <main class="center-main">
      <div class="center-topline">
        <nav class="breadcrumbs" aria-label="面包屑">
          <span>后台管理</span>
          <span>/</span><strong>接口监控</strong>
        </nav>
      </div>

      <div class="center-title">
        <div>
          <h1>接口状态监控 <span class="preview-badge">{{ prodMode ? '真实数据' : '示例数据' }}</span></h1>
          <p class="center-subtitle">查看服务连通性与接口探测结果</p>
        </div>
        <div class="adm-actions">
          <span class="adm-env" :class="prodMode ? 'is-prod' : 'is-dev'">
            <i class="adm-env-dot"></i>{{ prodMode ? '生产环境' : '开发环境' }}
          </span>
          <a-button class="adm-icon-btn" :loading="probingAll" title="重新探测" @click="onProbeAll">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
          </a-button>
          <a-button type="primary" :loading="probingAll" @click="onProbeAll">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style="margin-right:6px;vertical-align:-1px"><path d="m6 4 14 8-14 8Z" /></svg>批量探活
          </a-button>
        </div>
      </div>

      <!-- 健康卡 -->
      <div class="adm-health">
        <div v-for="c in healthCards" :key="c.label" class="adm-health-card" :class="`is-${c.tone}`" :style="{ '--adm-accent': c.color, '--adm-tint': c.bg }">
          <span class="adm-health-icon" :style="{ color: c.color, background: c.bg }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="c.icon" />
          </span>
          <div class="adm-health-body">
            <div class="adm-health-top">
              <span class="adm-health-label">{{ c.label }}</span>
              <span class="task-tag" :class="TAG_CLASS[c.tone]">{{ TAG_TEXT[c.tone] }}</span>
            </div>
            <strong class="adm-health-value" :title="(c as any).title">{{ c.value }}</strong>
            <div v-if="(c as any).lines" class="adm-health-lines">
              <span v-for="l in (c as any).lines" :key="l.k" class="adm-health-line"><em>{{ l.k }}</em><code :title="l.v">{{ l.v }}</code></span>
            </div>
            <span v-else class="adm-health-note" :title="(c as any).title">{{ healthLoading && !health ? '探测中…' : c.note }}</span>
          </div>
        </div>
      </div>

      <!-- 清单 -->
      <section class="adm-card">
          <div class="adm-list-head">
            <h3 class="adm-card-title">接口清单</h3>
            <div class="adm-tabs">
              <button
                v-for="f in filterTabs" :key="f.key" type="button"
                class="adm-tab" :class="[`tab-${f.key}`, { active: filter === f.key }]"
                @click="filter = f.key"
              >{{ f.label }} <b>{{ f.count }}</b></button>
            </div>
            <div class="adm-list-tools">
              <a-input v-model:value="keyword" size="small" style="width: 180px" placeholder="搜索接口名称或路径" allow-clear>
                <template #prefix><IconSvg name="inspect" /></template>
              </a-input>
              <span class="adm-mod-label">所属模块：</span>
              <a-select v-model:value="moduleFilter" size="small" style="width: 110px" :options="moduleOptions" />
            </div>
          </div>

          <div class="adm-banner">
            <IconSvg name="inspect" />
            <span>{{ prodMode ? '生产环境使用真实接口 · 写操作仅检查契约，不执行业务。' : '开发环境可逐接口切换 mock / 真实 · 探活仅只读请求，不产生副作用。' }}</span>
          </div>

          <a-table
            :data-source="filtered"
            :columns="columns"
            :pagination="pagination"
            row-key="key"
            size="middle"
            class="task-table adm-table"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'method'">
                <span class="adm-method" :class="methodClass(record.method)">{{ record.method }}</span>
              </template>

              <template v-else-if="column.key === 'path'">
                <code class="task-id">{{ record.path }}</code>
              </template>

              <template v-else-if="column.key === 'mode'">
                <span v-if="prodMode" class="task-tag tone-blue">真实接口</span>
                <a-switch
                  v-else
                  :checked="record.live"
                  size="small"
                  checked-children="真实"
                  un-checked-children="mock"
                  @update:checked="(v: boolean) => onToggle(record as ApiUnit, v)"
                />
              </template>

              <template v-else-if="column.key === 'probe'">
                <span class="task-tag" :class="statusClass(record.result.status)">{{ statusText(record.result.status) }}</span>
              </template>

              <template v-else-if="column.key === 'latency'">
                <div class="adm-lat">
                  <span class="adm-lat-bar"><i :style="{ width: latPct(record.result.latencyMs) + '%' }"></i></span>
                  <span class="adm-lat-num">{{ record.result.latencyMs != null ? record.result.latencyMs + ' ms' : '—' }}</span>
                </div>
              </template>

              <template v-else-if="column.key === 'time'">
                <span class="adm-time">{{ fmtTime(record.result.checkedAt) }}</span>
              </template>

              <template v-else-if="column.key === 'action'">
                <a-button type="link" size="small" :loading="rowBusy[record.key]" @click="onProbe(record as ApiUnit)">探测</a-button>
              </template>
            </template>
          </a-table>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* ---- 顶部操作区 ---- */
.adm-actions { display: flex; align-items: center; gap: 10px; }
:deep(.center-title) { margin: 18px 0 22px; }
:deep(.center-title h1) { display: flex; align-items: center; gap: 12px; }
:deep(.center-title h1 .preview-badge) { font-weight: 400; }
.adm-env {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 12.5px; font-weight: 500; line-height: 1;
  padding: 8px 12px; border-radius: 8px; border: 1px solid var(--c-line);
}
.adm-env-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.adm-env.is-prod { color: #1f8a4c; background: #e7f7ec; border-color: #b8e6c6; }
.adm-env.is-dev { color: #2368c9; background: #e9f2ff; border-color: #c4dcfb; }
.dark-theme .adm-env.is-prod { color: #73d13d; background: rgba(115, 209, 61, .12); border-color: rgba(115, 209, 61, .3); }
.dark-theme .adm-env.is-dev { color: #69b1ff; background: rgba(105, 177, 255, .12); border-color: rgba(105, 177, 255, .3); }
.adm-icon-btn { display: inline-flex; align-items: center; }

/* ---- 健康卡 ---- */
.adm-health { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; margin: 4px 0 22px; }
.adm-health-card {
  display: flex; align-items: center; gap: 14px;
  padding: 20px 22px; background: var(--c-panel);
  border: 1px solid var(--c-line); border-radius: 14px;
  box-shadow: 0 5px 18px var(--c-shadow);
}
.adm-health-icon {
  flex-shrink: 0; display: grid; place-items: center;
  width: 46px; height: 46px; border-radius: 12px;
}
.adm-health-icon svg { width: 24px; height: 24px; }
.adm-health-body { display: grid; gap: 5px; min-width: 0; }
.adm-health-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.adm-health-label { font-size: 13px; color: var(--c-muted); }
.adm-health-value { font-size: 24px; font-weight: 680; line-height: 1.1; color: var(--c-ink); }
.adm-health-note {
  font-size: 12px; color: var(--c-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.adm-health-lines { display: grid; gap: 3px; margin-top: 1px; }
.adm-health-line { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
.adm-health-line em {
  font-style: normal; font-size: 10.5px; font-weight: 650; line-height: 1;
  color: var(--adm-accent, #7562c9); background: var(--adm-tint, #f0eaff);
  border-radius: 4px; padding: 3px 5px; flex-shrink: 0;
}
.adm-health-line code {
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
  font-size: 12px; color: var(--c-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dark-theme .adm-health-line em { opacity: .9; filter: brightness(1.35); }

/* ---- 清单卡片 ---- */
.adm-card {
  background: var(--c-panel); border: 1px solid var(--c-line);
  border-radius: 14px; box-shadow: 0 5px 18px var(--c-shadow); padding: 20px 22px;
}
.adm-card-title { font-size: 17px; font-weight: 650; margin: 0; color: var(--c-ink); }

/* ---- 清单头 ---- */
.adm-list-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
.adm-tabs { display: inline-flex; gap: 6px; }
.adm-tab {
  font: inherit; font-size: 13px; cursor: pointer;
  padding: 6px 12px; border-radius: 999px;
  border: 1px solid var(--c-line); background: var(--c-panel); color: var(--c-muted);
}
.adm-tab b { font-weight: 650; font-variant-numeric: tabular-nums; }
.adm-tab.tab-ok.active { color: #1f8a4c; border-color: #b8e6c6; background: #e7f7ec; }
.adm-tab.tab-fail.active { color: #c0392f; border-color: #f3c9c5; background: #fdeceb; }
.adm-tab.tab-unknown.active { color: #64748b; border-color: #d8dfe8; background: #eef1f5; }
.adm-tab.tab-all.active { color: #fff; border-color: var(--c-blue); background: var(--c-blue); }
.adm-list-tools { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.adm-list-tools :deep(.ant-input-prefix) svg { width: 14px; height: 14px; color: var(--c-muted); }
.adm-mod-label { font-size: 12.5px; color: var(--c-muted); }

/* ---- 提示条 ---- */
.adm-banner {
  display: flex; align-items: center; gap: 9px;
  font-size: 12.5px; line-height: 1.6; color: #2368c9;
  padding: 10px 14px; border-radius: 9px; margin-bottom: 12px;
  background: #e9f2ff; border: 1px solid #c4dcfb;
}
.adm-banner svg { width: 16px; height: 16px; flex-shrink: 0; }
.dark-theme .adm-banner { color: #69b1ff; background: rgba(105, 177, 255, .1); border-color: rgba(105, 177, 255, .28); }

/* ---- 表格细节 ---- */
.adm-method {
  display: inline-block; font-size: 11px; font-weight: 600; line-height: 1;
  padding: 4px 7px; border-radius: 5px; border: 1px solid transparent;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
}
.adm-method.tone-blue { color: #2368c9; background: #e9f2ff; border-color: #c4dcfb; }
.adm-method.tone-amber { color: #b3751a; background: #fdf3e2; border-color: #f0d9a8; }
.adm-method.tone-gray { color: #64748b; background: #eef1f5; border-color: #d8dfe8; }
.dark-theme .adm-method.tone-blue { color: #69b1ff; background: rgba(105, 177, 255, .12); border-color: rgba(105, 177, 255, .28); }
.dark-theme .adm-method.tone-amber { color: #f0a35a; background: rgba(240, 163, 90, .12); border-color: rgba(240, 163, 90, .28); }

.adm-lat { display: flex; align-items: center; gap: 8px; }
.adm-lat-bar { flex: 1; max-width: 60px; height: 6px; border-radius: 3px; background: var(--c-line); overflow: hidden; }
.adm-lat-bar i { display: block; height: 100%; border-radius: 3px; background: var(--c-blue); transition: width .3s; }
.adm-lat-num { font-size: 12.5px; color: var(--c-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.adm-time { font-size: 12.5px; color: var(--c-muted); font-variant-numeric: tabular-nums; }

@media (max-width: 1200px) {
  .adm-health { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
