<script setup lang="ts">
/** 工具服务中心：左侧 6 项二级导航 + 右侧内容区。
 *  工具接入对接真实 capability 注册表 API，服务监测迁移自后台管理。
 *  其余 4 项为占位。 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import IconSvg from '@/components/IconSvg.vue';
import { setTheme, useTheme, activeNav } from '@/composables/use-theme';
import {
  prodMode, units, setMode, runProbe, probeAll, fetchPlatformHealth,
  type PlatformHealth, type ApiUnit,
} from '@/api/source-registry';
import {
  listCapabilities, getCapabilityDetail, createCapability, patchCapability, setCapabilityStatus,
  emptyCreate, typeLabel, adapterLabel, sceneLabel,
  SCENE_OPTIONS, TYPE_OPTIONS, ADAPTER_OPTIONS,
  type Capability, type CapabilityStatus, type CreatePayload,
} from '@/api/capability-registry';

const route = useRoute();
const theme = useTheme();
const dark = computed(() => theme.value === 'dark');
setTheme(route.query.theme === 'dark' ? 'dark' : 'light');

/* ---------------- 左侧导航 ---------------- */
const sidebarItems = [
  { key: 'access', label: '工具接入', icon: 'spark' },
  { key: 'skill', label: '技能管理', icon: 'grid' },
  { key: 'version', label: '版本与发布', icon: 'box' },
  { key: 'deploy', label: '部署与环境', icon: 'assembly' },
  { key: 'monitor', label: '服务监测', icon: 'test' },
  { key: 'template', label: '模板管理', icon: 'clipboard' },
];
const activeSidebar = ref('access');

onMounted(() => {
  activeNav.value = '工具服务中心';
  void loadTools();
});

/* ================================================================
   工具接入页（真实 quality-agent 契约：注册 / 编辑 / 启停，无删除）
   ================================================================ */
/** 真实状态 → 徒章样式（复用 verified/pending/unconnected 三色） */
const STATUS_BADGE: Record<CapabilityStatus, { label: string; cls: string }> = {
  enabled: { label: '启用', cls: 'verified' },
  maintenance: { label: '维护中', cls: 'pending' },
  disabled: { label: '停用', cls: 'unconnected' },
};

/** scene → 图标与主题色 */
const SCENE_VISUAL: Record<string, { icon: string; color: string; bg: string }> = {
  fpi: { icon: 'scan', color: '#16a34a', bg: '#dcfce7' },
  borescope: { icon: 'target', color: '#2563eb', bg: '#dbeafe' },
  infrared: { icon: 'heat', color: '#dc2626', bg: '#fee2e2' },
  dr: { icon: 'xray', color: '#7c3aed', bg: '#ede9fe' },
  fracture: { icon: 'inspect', color: '#0891b2', bg: '#cffafe' },
  metallography: { icon: 'shield', color: '#ea580c', bg: '#ffedd5' },
};
function getVisual(c: Capability) {
  return SCENE_VISUAL[c.scene] ?? { icon: 'wrench', color: '#64748b', bg: '#f1f5f9' };
}

const tools = ref<Capability[]>([]);
const toolsLoading = ref(false);
const toolsLive = ref(false);

/** 加载真实工具列表，失败时降级为空 */
async function loadTools() {
  toolsLoading.value = true;
  try {
    const list = await listCapabilities();
    tools.value = list;
    toolsLive.value = list.length > 0;
  } catch (e: any) {
    tools.value = [];
    toolsLive.value = false;
    message.error(e?.message || '加载工具列表失败');
  } finally {
    toolsLoading.value = false;
  }
}

const activeTab = ref<'pro' | 'label'>('pro');
const statusFilter = ref<'all' | CapabilityStatus>('all');
const keyword = ref('');
const sceneDropdown = ref('all');
const adapterDropdown = ref('all');

const countBy = (s: CapabilityStatus) => tools.value.filter((t) => t.status === s).length;
const statusChips = computed(() => [
  { key: 'all' as const, label: '全部', count: tools.value.length },
  { key: 'enabled' as const, label: '启用', count: countBy('enabled') },
  { key: 'maintenance' as const, label: '维护中', count: countBy('maintenance') },
  { key: 'disabled' as const, label: '停用', count: countBy('disabled') },
]);
const filteredTools = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return tools.value.filter(
    (t) => (statusFilter.value === 'all' || t.status === statusFilter.value) &&
      (sceneDropdown.value === 'all' || t.scene === sceneDropdown.value) &&
      (adapterDropdown.value === 'all' || t.adapter_type === adapterDropdown.value) &&
      (!kw || `${t.name}${t.capability_id}${t.scene}${t.tool_name}`.toLowerCase().includes(kw)),
  );
});
function resetFilters() { keyword.value = ''; statusFilter.value = 'all'; sceneDropdown.value = 'all'; adapterDropdown.value = 'all'; }

/* ---------------- 注册 / 编辑弹窗 ---------------- */
const modalOpen = ref(false);
const editing = ref(false);
const submitting = ref(false);
const detailLoading = ref(false);
const editVersion = ref(0);
const form = reactive<CreatePayload>(emptyCreate());

function openCreate() {
  editing.value = false;
  Object.assign(form, emptyCreate());
  modalOpen.value = true;
}
async function openEdit(record: Capability) {
  editing.value = true;
  Object.assign(form, emptyCreate(), { capability_id: record.capability_id, tool_name: record.tool_name });
  modalOpen.value = true;
  detailLoading.value = true;
  try {
    const d = await getCapabilityDetail(record.capability_id);
    editVersion.value = d.version;
    Object.assign(form, {
      capability_id: d.capability_id, tool_name: d.tool_name, scene: d.scene,
      endpoint: d.endpoint, tool_version: d.tool_version, model_version: d.model_version,
      capability_type: d.capability_type, adapter_type: d.adapter_type,
      api_version: d.api_version, timeout_s: d.timeout_s, max_retry: d.max_retry,
      description: d.description ?? '', health_endpoint: d.health_endpoint,
    });
  } catch (e: any) {
    message.error(e?.message || '加载详情失败');
    modalOpen.value = false;
  } finally {
    detailLoading.value = false;
  }
}
async function submit() {
  if (!form.capability_id.trim() || !form.tool_name.trim() || !form.scene) {
    message.warning('能力 ID、工具名、场景为必填'); return;
  }
  if (!form.endpoint.trim() || !form.tool_version.trim() || !form.model_version.trim()) {
    message.warning('端点、工具版本、模型版本为必填'); return;
  }
  if (!form.change_reason.trim()) { message.warning('请填写变更原因（审计留痕）'); return; }
  submitting.value = true;
  try {
    if (editing.value) {
      await patchCapability(form.capability_id, {
        expected_version: editVersion.value,
        change_reason: form.change_reason.trim(),
        scene: form.scene, capability_type: form.capability_type, adapter_type: form.adapter_type,
        endpoint: form.endpoint, tool_version: form.tool_version, model_version: form.model_version,
        api_version: form.api_version, timeout_s: form.timeout_s, max_retry: form.max_retry,
        description: form.description ?? null,
      });
      message.success('工具已更新');
    } else {
      await createCapability({ ...form, change_reason: form.change_reason.trim() });
      message.success('工具已注册（新行默认停用，启用需端点健康探测通过）');
    }
    modalOpen.value = false;
    await loadTools();
  } catch (e: any) {
    message.error(e?.message || '保存失败');
  } finally {
    submitting.value = false;
  }
}

/* ---------------- 启停（需变更原因，启用走后端健康探测） ---------------- */
const reasonOpen = ref(false);
const reasonBusy = ref(false);
const reasonTarget = ref<Capability | null>(null);
const reasonIntent = ref<CapabilityStatus>('enabled');
const reasonText = ref('');
function askToggle(record: Capability, checked: boolean) {
  reasonTarget.value = record;
  reasonIntent.value = checked ? 'enabled' : 'disabled';
  reasonText.value = '';
  reasonOpen.value = true;
}
async function confirmToggle() {
  const t = reasonTarget.value;
  if (!t) return;
  if (!reasonText.value.trim()) { message.warning('请填写变更原因'); return; }
  reasonBusy.value = true;
  try {
    await setCapabilityStatus(t.capability_id, reasonIntent.value, reasonText.value.trim());
    message.success(reasonIntent.value === 'enabled' ? '已启用' : '已停用');
    reasonOpen.value = false;
    await loadTools();
  } catch (e: any) {
    message.error(e?.message || '操作失败');
  } finally {
    reasonBusy.value = false;
  }
}

/* ================================================================
   服务监测页（迁移自后台管理 · 接口监控）
   ================================================================ */
const health = ref<PlatformHealth | null>(null);
const healthLoading = ref(false);
const probingAll = ref(false);
const rowBusy = reactive<Record<string, boolean>>({});

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
    { label: '后端服务', value: !h ? '—' : svcOk ? '在线' : h.status === '—' ? '未知' : '降级', note: !h ? '加载中…' : (h.error || '存活探测通过'), lines: svcLines, title: svcLines ? `平台版本 v${h!.platformVersion}` : undefined, tone: (!h ? 'idle' : svcOk ? 'ok' : 'bad') as Tone, icon: ICONS.server, color: '#1f8a4c', bg: '#e7f7ec' },
    { label: '数据库', value: !h ? '—' : dOk ? '已连接' : h.database, note: !h ? '加载中…' : `最近检查 ${fmtTime(Date.now())}`, lines: dbLines, title: dbLabel ? `${dbLabel}｜最近检查 ${fmtTime(Date.now())}` : undefined, tone: (!h ? 'idle' : dOk ? 'ok' : 'warn') as Tone, icon: ICONS.database, color: '#2368c9', bg: '#e9f2ff' },
    { label: '推理模型 VLM / LLM', value: !h ? '—' : h.vlmAvailable ? '可达' : '不可用', note: !h ? '加载中…' : modelNote, lines: modelLines, title: modelTitle, tone: (!h ? 'idle' : h.vlmAvailable ? 'ok' : 'warn') as Tone, icon: ICONS.cpu, color: '#7562c9', bg: '#f0eaff' },
    { label: '知识服务 RAGFlow', value: !h ? '—' : h.ragflowError && !h.ragflowReachable ? '探测失败' : h.ragflowReachable ? '可达' : h.ragflowConfigured ? '不可达' : '未配置', note: !h ? '加载中…' : (h.ragflowError && !h.ragflowReachable ? h.ragflowError : `知识库 ${h.ragflowDocCount} 篇文档`), lines: rfLines, title: h?.ragflowVersion ? `RAGFlow ${h.ragflowVersion}｜知识库 ${h.ragflowDocCount} 篇文档` : undefined, tone: (!h ? 'idle' : h.ragflowError && !h.ragflowReachable ? 'warn' : h.ragflowReachable ? 'ok' : h.ragflowConfigured ? 'bad' : 'idle') as Tone, icon: ICONS.book, color: '#d1701f', bg: '#fdf3e2' },
  ];
});

type FilterKey = 'all' | 'ok' | 'fail' | 'unknown';
const filter = ref<FilterKey>('all');
const monitorKeyword = ref('');
const moduleFilter = ref('all');

const counts = computed(() => {
  const c = { all: units.list.length, ok: 0, fail: 0, unknown: 0 };
  for (const u of units.list) { if (u.result.status === 'ok') c.ok++; else if (u.result.status === 'fail') c.fail++; else c.unknown++; }
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
const filteredUnits = computed(() => {
  const kw = monitorKeyword.value.trim().toLowerCase();
  return units.list.filter((u) => matchFilter(u) && (moduleFilter.value === 'all' || u.group === moduleFilter.value) && (!kw || (u.label + u.path).toLowerCase().includes(kw)));
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
const pagination = computed(() => ({ pageSize: 8, size: 'small', showSizeChanger: true, pageSizeOptions: ['8', '15', '30'], showTotal: (t: number) => `共 ${t} 条` }));

function statusText(s: ApiUnit['result']['status']): string { return s === 'ok' ? '正常' : s === 'fail' ? '异常' : s === 'checking' ? '探测中' : '未检测'; }
function statusClass(s: ApiUnit['result']['status']): string { return s === 'ok' ? 'tone-green' : s === 'fail' ? 'tone-red' : s === 'checking' ? 'tone-blue' : 'tone-gray'; }
function methodClass(m: string): string { return m === 'GET' ? 'tone-blue' : m === 'POST' ? 'tone-amber' : 'tone-gray'; }
function latPct(ms: number | null): number { if (!ms || ms < 0) return 0; return Math.max(6, Math.min(100, Math.round((ms / 250) * 100))); }
function fmtTime(ts: number | null): string { if (!ts) return '—'; const d = new Date(ts); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }

async function loadHealth() { healthLoading.value = true; health.value = await fetchPlatformHealth(); healthLoading.value = false; }
async function onProbe(u: ApiUnit) { rowBusy[u.key] = true; await runProbe(u.key); rowBusy[u.key] = false; }
async function onProbeAll() { probingAll.value = true; await probeAll(); await loadHealth(); probingAll.value = false; }
function onToggle(u: ApiUnit, live: boolean) { setMode(u.key, live); if (live) void onProbe(u); }

/* 占位提示 */
function notReady(name: string) { message.info(`${name}：模块开发中，敬请期待。`, 2.4); }
</script>

<template>
  <div class="tool-layout">
    <!-- 左侧二级导航 -->
    <aside class="tool-sidebar">
      <div class="tool-sidebar-title">工具服务中心</div>
      <nav class="tool-sidebar-nav">
        <a
          v-for="item in sidebarItems"
          :key="item.key"
          :class="{ active: activeSidebar === item.key }"
          @click.prevent="activeSidebar = item.key"
        >
          <IconSvg :name="item.icon" />
          <span>{{ item.label }}</span>
        </a>
      </nav>
    </aside>

    <!-- 右侧主内容 -->
    <main class="tool-main">

      <!-- ========== 工具接入 ========== -->
      <template v-if="activeSidebar === 'access'">
        <div class="tool-breadcrumb">工具服务中心 / 工具接入</div>
        <div class="tool-header">
          <div class="tool-header-left">
            <h1>工具接入</h1>
            <p class="tool-subtitle">统一登记专业工具与接口，验证后供平台调用</p>
          </div>
          <div class="tool-header-actions">
            <span class="preview-badge">{{ toolsLive ? '真实数据' : '暂无数据' }}</span>
            <button class="tool-btn" type="button" :disabled="toolsLoading" @click="loadTools">
              <IconSvg name="scan" /> 刷新
            </button>
            <button class="tool-btn primary" type="button" @click="openCreate">
              <span>+</span> 注册工具
            </button>
          </div>
        </div>
        <div class="tool-tabs">
          <button :class="{ active: activeTab === 'pro' }" type="button" @click="activeTab = 'pro'">专业工具</button>
          <button :class="{ active: activeTab === 'label' }" type="button" @click="activeTab = 'label'">标注工具</button>
        </div>
        <div class="tool-filter-row">
          <div class="tool-filter-chips">
            <button v-for="c in statusChips" :key="c.key" :class="{ active: statusFilter === c.key }" type="button" @click="statusFilter = c.key">{{ c.label }}&nbsp;&nbsp;{{ c.count }}</button>
          </div>
          <div class="tool-filter-right">
            <label class="tool-search-box"><IconSvg name="inspect" /><input v-model="keyword" type="text" placeholder="搜索工具名称或标识" /></label>
            <select v-model="sceneDropdown" class="tool-select"><option value="all">场景：全部</option><option v-for="s in SCENE_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option></select>
            <select v-model="adapterDropdown" class="tool-select"><option value="all">适配器：全部</option><option v-for="a in ADAPTER_OPTIONS" :key="a.value" :value="a.value">{{ a.label }}</option></select>
            <button class="tool-btn" type="button" @click="resetFilters">重置</button>
          </div>
        </div>
        <div class="tool-table-wrap">
          <table class="tool-table">
            <thead><tr><th style="width:260px">工具名称</th><th style="width:130px">场景</th><th style="width:100px">类型</th><th style="width:130px">适配器</th><th style="width:96px">版本</th><th style="width:100px">状态</th><th style="width:170px">操作</th></tr></thead>
            <tbody>
              <tr v-if="toolsLoading" v-for="i in 3" :key="'sk-'+i" class="tool-skeleton-row">
                <td><div class="tool-name-cell"><span class="tool-icon-tile sk-bar" /><div><span class="sk-bar" style="width:60%" /><span class="sk-bar" style="width:40%" /></div></div></td>
                <td><span class="sk-bar" style="width:52px" /></td><td><span class="sk-bar" style="width:44px" /></td><td><span class="sk-bar" style="width:60px" /></td><td><span class="sk-bar" style="width:40px" /></td><td><span class="sk-bar" style="width:44px" /></td><td></td>
              </tr>
              <tr v-else v-for="row in filteredTools" :key="row.capability_id">
                <td><div class="tool-name-cell"><span class="tool-icon-tile" :style="{ background: getVisual(row).bg, color: getVisual(row).color }"><IconSvg :name="getVisual(row).icon" /></span><div><strong>{{ row.name }}</strong><code>{{ row.capability_id }}</code></div></div></td>
                <td>{{ sceneLabel(row.scene) }}</td>
                <td>{{ typeLabel(row.capability_type) }}</td>
                <td>{{ adapterLabel(row.adapter_type) }}</td>
                <td><code class="tool-ver">v{{ row.tool_version }}</code></td>
                <td><span class="tool-status-badge" :class="STATUS_BADGE[row.status].cls"><i></i>{{ STATUS_BADGE[row.status].label }}</span></td>
                <td><div class="tool-actions">
                  <a-switch :checked="row.status === 'enabled'" size="small" checked-children="启" un-checked-children="停" @update:checked="(v: boolean) => askToggle(row, v)" />
                  <button class="tool-link" type="button" @click="openEdit(row)">编辑</button>
                </div></td>
              </tr>
              <tr v-if="!toolsLoading && !filteredTools.length"><td colspan="7" class="tool-empty-cell">{{ tools.length ? '没有匹配的工具' : '暂无工具，点击右上角“注册工具”新增' }}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="tool-pagination">
          <span class="tool-pagination-info">共 {{ filteredTools.length }} 项工具</span>
          <div class="tool-pagination-controls">
            <button class="page-btn" type="button" disabled>&lt;</button>
            <button class="page-btn active" type="button">1</button>
            <button class="page-btn" type="button" disabled>&gt;</button>
            <select class="page-size-select"><option>10 条/页</option><option>20 条/页</option><option>50 条/页</option></select>
          </div>
        </div>
        <p class="tool-foot-note">新注册的工具默认停用，启停需填写变更原因；启用前平台会先探测端点健康。后端不提供删除，下线请用“停用”。</p>

        <!-- 注册 / 编辑弹窗 -->
        <a-modal
          v-model:open="modalOpen"
          :title="editing ? '编辑工具' : '注册工具'"
          :confirm-loading="submitting"
          :ok-text="editing ? '保存' : '注册'"
          cancel-text="取消"
          width="640px"
          @ok="submit"
        >
          <a-form layout="vertical" class="tool-form">
            <a-row :gutter="16">
              <a-col :span="12"><a-form-item label="能力 ID" required><a-input v-model:value="form.capability_id" :disabled="editing" placeholder="如 borescope_defect_v1" /></a-form-item></a-col>
              <a-col :span="12"><a-form-item label="工具名（tool_name）" required><a-input v-model:value="form.tool_name" :disabled="editing" placeholder="须与算法工具 /health 自报名一致" /></a-form-item></a-col>
            </a-row>
            <a-row :gutter="16">
              <a-col :span="12"><a-form-item label="场景（路由键）" required><a-select v-model:value="form.scene" :options="SCENE_OPTIONS" /></a-form-item></a-col>
              <a-col :span="12"><a-form-item label="结果类型"><a-select v-model:value="form.capability_type" :options="TYPE_OPTIONS" /></a-form-item></a-col>
            </a-row>
            <a-row :gutter="16">
              <a-col :span="12"><a-form-item label="适配器类型"><a-select v-model:value="form.adapter_type" :options="ADAPTER_OPTIONS" /></a-form-item></a-col>
              <a-col :span="6"><a-form-item label="工具版本" required><a-input v-model:value="form.tool_version" placeholder="1.0.0" /></a-form-item></a-col>
              <a-col :span="6"><a-form-item label="模型版本" required><a-input v-model:value="form.model_version" placeholder="1.0.0" /></a-form-item></a-col>
            </a-row>
            <a-form-item label="调用端点" required><a-input v-model:value="form.endpoint" placeholder="http://<tool-host>:<port>/api/v1/inference" /></a-form-item>
            <a-form-item label="说明（作为展示名）"><a-textarea v-model:value="form.description" :rows="2" placeholder="能力用途简述，列表“工具名称”列即取此值" /></a-form-item>
            <a-form-item label="变更原因（审计留痕）" required><a-input v-model:value="form.change_reason" :maxlength="100" placeholder="一句话说明本次登记/修改缘由" /></a-form-item>
            <p v-if="!editing" class="tool-form-tip">新行将以“停用”落库；启用需在列表中切换开关，平台会先跑一次端点健康探测。</p>
          </a-form>
        </a-modal>

        <!-- 启停变更原因弹窗 -->
        <a-modal
          v-model:open="reasonOpen"
          :title="reasonIntent === 'enabled' ? '启用工具' : '停用工具'"
          :confirm-loading="reasonBusy"
          ok-text="确认"
          cancel-text="取消"
          width="460px"
          @ok="confirmToggle"
        >
          <p class="tool-reason-cur">目标：<strong>{{ reasonTarget?.name }}</strong>（{{ reasonTarget?.capability_id }}）</p>
          <p v-if="reasonIntent === 'enabled'" class="tool-reason-tip">启用前平台会先探测端点健康，不通将被拒绝。</p>
          <a-form layout="vertical">
            <a-form-item label="变更原因（必填）"><a-input v-model:value="reasonText" :maxlength="100" placeholder="如：联调通过，正式接入生产" /></a-form-item>
          </a-form>
        </a-modal>
      </template>

      <!-- ========== 服务监测 ========== -->
      <template v-else-if="activeSidebar === 'monitor'">
        <div class="tool-breadcrumb">工具服务中心 / 服务监测</div>
        <div class="tool-header">
          <div class="tool-header-left">
            <h1>服务监测 <span class="preview-badge">{{ prodMode ? '真实数据' : '示例数据' }}</span></h1>
            <p class="tool-subtitle">查看服务连通性与接口探测结果</p>
          </div>
          <div class="tool-header-actions">
            <span class="adm-env" :class="prodMode ? 'is-prod' : 'is-dev'"><i class="adm-env-dot"></i>{{ prodMode ? '生产环境' : '开发环境' }}</span>
            <button class="tool-btn icon-only" type="button" :class="{ 'is-spin': probingAll }" :disabled="probingAll" title="重新探测" @click="onProbeAll">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
            </button>
            <button class="tool-btn primary" type="button" :disabled="probingAll" @click="onProbeAll">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style="margin-right:6px;vertical-align:-1px"><path d="m6 4 14 8-14 8Z" /></svg>批量探活
            </button>
          </div>
        </div>

        <!-- 健康卡 -->
        <div class="adm-health">
          <div
            v-for="c in healthCards" :key="c.label" class="adm-health-card" :class="`is-${c.tone}`"
            :style="{ '--adm-accent': c.color, '--adm-tint': c.bg }"
          >
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
                <button v-for="f in filterTabs" :key="f.key" type="button" class="adm-tab" :class="[`tab-${f.key}`, { active: filter === f.key }]" @click="filter = f.key">{{ f.label }} <b>{{ f.count }}</b></button>
              </div>
              <div class="adm-list-tools">
                <a-input v-model:value="monitorKeyword" size="small" style="width:180px" placeholder="搜索接口名称或路径" allow-clear>
                  <template #prefix><IconSvg name="inspect" /></template>
                </a-input>
                <span class="adm-mod-label">所属模块：</span>
                <a-select v-model:value="moduleFilter" size="small" style="width:110px" :options="moduleOptions" />
              </div>
            </div>
            <div class="adm-banner">
              <IconSvg name="inspect" />
              <span>{{ prodMode ? '生产环境使用真实接口 · 写操作仅检查契约，不执行业务。' : '开发环境可逐接口切换 mock / 真实 · 探活仅只读请求，不产生副作用。' }}</span>
            </div>
            <a-table :data-source="filteredUnits" :columns="columns" :pagination="pagination" row-key="key" size="middle" class="task-table adm-table">
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'method'"><span class="adm-method" :class="methodClass(record.method)">{{ record.method }}</span></template>
                <template v-else-if="column.key === 'path'"><code class="task-id">{{ record.path }}</code></template>
                <template v-else-if="column.key === 'mode'">
                  <span v-if="prodMode" class="task-tag tone-blue">真实接口</span>
                  <a-switch v-else :checked="record.live" size="small" checked-children="真实" un-checked-children="mock" @update:checked="(v: boolean) => onToggle(record as ApiUnit, v)" />
                </template>
                <template v-else-if="column.key === 'probe'"><span class="task-tag" :class="statusClass(record.result.status)">{{ statusText(record.result.status) }}</span></template>
                <template v-else-if="column.key === 'latency'"><div class="adm-lat"><span class="adm-lat-bar"><i :style="{ width: latPct(record.result.latencyMs) + '%' }"></i></span><span class="adm-lat-num">{{ record.result.latencyMs != null ? record.result.latencyMs + ' ms' : '—' }}</span></div></template>
                <template v-else-if="column.key === 'time'"><span class="adm-time">{{ fmtTime(record.result.checkedAt) }}</span></template>
                <template v-else-if="column.key === 'action'"><a-button type="link" size="small" :loading="rowBusy[record.key]" @click="onProbe(record as ApiUnit)">探测</a-button></template>
              </template>
            </a-table>
        </section>
      </template>

      <!-- ========== 其他占位 ========== -->
      <template v-else>
        <div class="tool-breadcrumb">工具服务中心 / {{ sidebarItems.find((s) => s.key === activeSidebar)?.label }}</div>
        <div class="tool-placeholder">
          <IconSvg name="box" />
          <h3>{{ sidebarItems.find((s) => s.key === activeSidebar)?.label }}</h3>
          <p>模块开发中，敬请期待。</p>
        </div>
      </template>

    </main>
  </div>
</template>
