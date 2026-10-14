/** 接口数据源路由层（阶段一 · 地基）
 *  —— 全局只有一个总闸 VITE_QA_ENABLED；这里在其下细分「逐接口单元」的 mock/真实控制：
 *  · 生产（VITE_QA_ENABLED=true）：所有单元恒真实，开关只读；
 *  · 开发（=false）：每个单元可在「后台 · 接口监控」页切 mock/真实，选择持久化到 localStorage。
 *  业务 composable 通过 isLive(key) 响应式判断走真实接口还是本地演示。 */
import { reactive } from 'vue';

const BASE = import.meta.env.VITE_QA_API_BASE || '/api/v1';

/** 生产模式总闸：true 时逐接口开关失效，全部强制真实。 */
export const prodMode = import.meta.env.VITE_QA_ENABLED === 'true';

export type ProbeStatus = 'idle' | 'checking' | 'ok' | 'fail';

export interface ProbeState {
  status: ProbeStatus;
  latencyMs: number | null;
  /** 最近一次探活的 HTTP 状态码（网络层失败为 null） */
  httpStatus: number | null;
  message: string;
  checkedAt: number | null;
}

export interface ApiUnit {
  key: string;
  label: string;
  group: string;
  method: string;
  /** 真实业务端点（展示用） */
  path: string;
  /** 探活实际请求的只读 GET 路径（写端点用代表性只读探针，不落库） */
  probePath: string;
  live: boolean;
  result: ProbeState;
}

const MODE_PREFIX = 'va-api-mode-';

function readOverride(key: string): boolean | null {
  try {
    const v = localStorage.getItem(MODE_PREFIX + key);
    if (v === 'live') return true;
    if (v === 'mock') return false;
  } catch { /* 隐私模式忽略 */ }
  return null;
}

function writeOverride(key: string, live: boolean): void {
  try { localStorage.setItem(MODE_PREFIX + key, live ? 'live' : 'mock'); } catch { /* ignore */ }
}

/** 接口单元清单：新增真实化的端点在此登记即可被监控页管理与探活。 */
const DEFS: Array<Omit<ApiUnit, 'live' | 'result'>> = [
  { key: 'auth', label: '登录鉴权', group: '平台', method: 'GET', path: '/auth/me', probePath: '/auth/me' },
  { key: 'health', label: '平台健康', group: '平台', method: 'GET', path: '/health', probePath: '/health' },
  { key: 'scenes', label: '场景目录', group: '平台', method: 'GET', path: '/scenes', probePath: '/scenes' },
  { key: 'capabilities', label: '能力注册', group: '能力中心', method: 'GET', path: '/capabilities', probePath: '/capabilities' },
  { key: 'capabilities.health', label: '能力健康', group: '能力中心', method: 'GET', path: '/capabilities/health', probePath: '/capabilities/health' },
  { key: 'ragflow.status', label: 'RAGFlow 状态', group: '知识中心', method: 'GET', path: '/ragflow/status', probePath: '/ragflow/status' },
  { key: 'ragflow.search', label: '知识检索', group: '知识中心', method: 'POST', path: '/ragflow/search', probePath: '/ragflow/status' },
  { key: 'ragflow.chat', label: '知识会话', group: '知识中心', method: 'GET', path: '/ragflow/chat', probePath: '/ragflow/chat' },
  { key: 'agent.sessions', label: '助手会话', group: '智能检测', method: 'GET', path: '/agent/sessions', probePath: '/agent/sessions' },
  { key: 'tasks.list', label: '任务列表', group: '任务中心', method: 'GET', path: '/tasks', probePath: '/tasks?limit=1' },
  { key: 'tasks.stats', label: '任务统计', group: '任务中心', method: 'GET', path: '/tasks/stats', probePath: '/tasks/stats' },
  { key: 'tasks.detail', label: '任务详情', group: '任务中心', method: 'GET', path: '/tasks/{id}', probePath: '/tasks?limit=1' },
  { key: 'tasks.submit', label: '提交任务', group: '任务中心', method: 'POST', path: '/tasks', probePath: '/tasks?limit=1' },
  { key: 'tasks.review', label: '人工复核', group: '任务中心', method: 'POST', path: '/tasks/{id}/review', probePath: '/tasks?limit=1' },
  { key: 'tasks.sceneConfirm', label: '场景歧义确认', group: '任务中心', method: 'POST', path: '/tasks/{id}/scene-confirm', probePath: '/tasks?limit=1' },
  { key: 'tasks.retry', label: '失败重试', group: '任务中心', method: 'POST', path: '/tasks/{id}/retry', probePath: '/tasks?limit=1' },
];

function buildUnits(): ApiUnit[] {
  return DEFS.map((d) => ({
    ...d,
    live: prodMode ? true : (readOverride(d.key) ?? true),
    result: { status: 'idle' as ProbeStatus, latencyMs: null, httpStatus: null, message: '', checkedAt: null },
  }));
}

export const units = reactive<{ list: ApiUnit[] }>({ list: buildUnits() });

function find(key: string): ApiUnit | undefined {
  return units.list.find((u) => u.key === key);
}

/** 该接口单元当前是否走真实后端（生产恒 true）。 */
export function isLive(key: string): boolean {
  if (prodMode) return true;
  return find(key)?.live ?? true;
}

/** 切换某单元的 mock/真实（仅开发期生效）。 */
export function setMode(key: string, live: boolean): void {
  if (prodMode) return;
  const u = find(key);
  if (!u) return;
  u.live = live;
  writeOverride(key, live);
}

interface Envelope { code?: number; message?: string }

async function probeOnce(path: string): Promise<number> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) { const e: any = new Error('未登录或会话已失效'); e.httpStatus = 401; throw e; }
  let json: Envelope | null = null;
  try { json = (await res.json()) as Envelope; } catch { /* 非信封：按 HTTP 状态判定 */ }
  if (!res.ok || (json && typeof json.code === 'number' && json.code !== 0)) {
    const e: any = new Error((json && json.message) || `HTTP ${res.status}`);
    e.httpStatus = res.status;
    throw e;
  }
  return res.status;
}

/** 探活单个单元：回填状态灯 / 延迟 / HTTP 状态 / 错误信息。 */
export async function runProbe(key: string): Promise<void> {
  const u = find(key);
  if (!u) return;
  u.result = { status: 'checking', latencyMs: null, httpStatus: null, message: '探测中…', checkedAt: u.result.checkedAt };
  const t0 = performance.now();
  try {
    const code = await probeOnce(u.probePath);
    u.result = { status: 'ok', latencyMs: Math.round(performance.now() - t0), httpStatus: code, message: '连通正常', checkedAt: Date.now() };
  } catch (e: any) {
    u.result = { status: 'fail', latencyMs: Math.round(performance.now() - t0), httpStatus: e?.httpStatus ?? null, message: e?.message || '探活失败', checkedAt: Date.now() };
  }
}

/** 批量探活全部单元。 */
export async function probeAll(): Promise<void> {
  await Promise.all(units.list.map((u) => runProbe(u.key)));
}

/* ---------------- 平台健康汇总（监控页顶部） ---------------- */
async function unwrapGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include', headers: { Accept: 'application/json' } });
  if (res.status === 401) throw new Error('未登录或会话已失效');
  const json: any = await res.json().catch(() => null);
  if (!res.ok || (json && typeof json.code === 'number' && json.code !== 0)) {
    throw new Error((json && json.message) || `HTTP ${res.status}`);
  }
  return (json && typeof json === 'object' && 'result' in json ? json.result : json) as T;
}

export interface PlatformHealth {
  loaded: boolean;
  status: string;
  database: string;
  vlmAvailable: boolean;
  vlmModel: string;
  llmModel: string;
  llmProvider: string;
  /** /health 是否下发了型号字段（旧后端缺失时区分「未配置」与「未上报」） */
  modelReported: boolean;
  /** 平台自身版本（/health → platform_version） */
  platformVersion: string;
  /** 数据库选型与服务端版本（/health → database_product / database_version） */
  dbProduct: string;
  dbVersion: string;
  serverDatetime: string;
  ragflowConfigured: boolean;
  ragflowReachable: boolean;
  ragflowDocCount: number;
  /** RAGFlow 服务端版本（旧版无 /system/version 时为空） */
  ragflowVersion: string;
  /** RAGFlow 状态探测失败原因（区分「未配置」与「探测失败」，不再静默误标） */
  ragflowError: string;
  error: string;
}

const EMPTY_HEALTH: PlatformHealth = {
  loaded: false, status: '—', database: '—', vlmAvailable: false,
  vlmModel: '', llmModel: '', llmProvider: '', modelReported: false,
  platformVersion: '', dbProduct: '', dbVersion: '',
  serverDatetime: '',
  ragflowConfigured: false, ragflowReachable: false, ragflowDocCount: 0, ragflowVersion: '', ragflowError: '', error: '',
};

/** 汇总 /health + /ragflow/status，供监控页顶部读数；任一失败降级为占位不阻断。 */
export async function fetchPlatformHealth(): Promise<PlatformHealth> {
  const out: PlatformHealth = { ...EMPTY_HEALTH, loaded: true };
  try {
    const h: any = await unwrapGet('/health');
    out.status = String(h.status ?? '—');
    out.database = String(h.database ?? '—');
    out.vlmAvailable = !!h.vlm_available;
    out.vlmModel = String(h.vlm_model ?? '');
    out.llmModel = String(h.llm_model ?? '');
    out.llmProvider = String(h.llm_provider ?? '');
    out.modelReported = 'vlm_model' in h || 'llm_model' in h;
    out.platformVersion = String(h.platform_version ?? '');
    out.dbProduct = String(h.database_product ?? '');
    out.dbVersion = String(h.database_version ?? '');
    out.serverDatetime = String(h.server_datetime ?? h.server_date ?? '');
  } catch (e: any) {
    out.error = e?.message || '后端健康探测失败';
  }
  try {
    const r: any = await unwrapGet('/ragflow/status');
    out.ragflowConfigured = !!r.configured;
    out.ragflowReachable = !!r.reachable;
    out.ragflowDocCount = Number(r.doc_count ?? 0) || 0;
    out.ragflowVersion = String(r.version ?? '');
  } catch (e: any) { /* 失败不阻断其他读数，但留痕供卡片区分「探测失败」与「未配置」 */
    out.ragflowError = e?.message || 'RAGFlow 状态探测失败';
  }
  return out;
}
