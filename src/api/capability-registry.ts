/** 能力/接口注册 API（对接 quality-agent 后端 /api/v1/capabilities，经同源 /api 代理转发）
 *  统一信封 {code,message,result}，code!==0 / 401 / 非 2xx 抛错。
 *  字段逐一对齐后端 app/models/capability.py（CapabilitySummary / CapabilityDetail /
 *  CapabilityCreateBody / CapabilityPatchBody / CapabilityStatusBody）。
 *  写侧治理：change_reason 必填；编辑走乐观锁 expected_version；启用需端点健康探测通过；无删除接口。 */

const BASE = import.meta.env.VITE_QA_API_BASE || '/api/v1';

export type LifecyclePhase =
  | 'design' | 'manufacturing' | 'assembly' | 'testing'
  | 'in_service' | 'maintenance' | 'retirement';
/** 结果类型：与后端 CapabilityType 一致（缺陷检测为 defect_detection）。 */
export type CapabilityType = 'defect_detection' | 'measurement' | 'classification';
export type AdapterType = 'http' | 'model_service' | 'local_bridge' | 'mock';
export type CapabilityStatus = 'enabled' | 'disabled' | 'maintenance';

/** 列表摘要（GET /capabilities → CapabilitySummary）：后端不下发 endpoint / lifecycle_phase。 */
export interface CapabilitySummary {
  capability_id: string;
  tool_name: string;
  tool_version: string;
  model_version: string;
  display_name: string;
  scene: string;
  capability_type: CapabilityType;
  adapter_type: AdapterType;
  status: CapabilityStatus;
  note: string;
}

/** 详情（GET /capabilities/{id} → CapabilityDetail）：含端点、乐观锁 version 与快照。 */
export interface CapabilityDetail {
  capability_id: string;
  tool_name: string;
  scene: string;
  capability_type: CapabilityType;
  adapter_type: AdapterType;
  endpoint: string;
  health_endpoint: string | null;
  tool_version: string;
  model_version: string;
  api_version: string;
  input_schema: Record<string, unknown> | null;
  output_schema: Record<string, unknown> | null;
  timeout_s: number;
  max_retry: number;
  status: CapabilityStatus;
  description: string | null;
  model_weights_sha256: string | null;
  meta: Record<string, unknown>;
  headers_masked: Record<string, string>;
  change_log: Array<Record<string, unknown>>;
  version: number;
  snapshot: string;
  editable: boolean;
}

/** 归一视图模型：兼容能力中心旧字段（name/description/lifecycle_phase/endpoint/version），
 *  由 CapabilitySummary 映射而来；endpoint/version 为占位，需详情端点补齐。 */
export interface Capability {
  capability_id: string;
  name: string;
  scene: string;
  lifecycle_phase: LifecyclePhase;
  capability_type: CapabilityType;
  adapter_type: AdapterType;
  endpoint: string;
  tool_name: string;
  description: string;
  parameters: Record<string, unknown>;
  status: CapabilityStatus;
  version: number;
  tool_version: string;
  model_version: string;
  note: string;
}

/** 登记新能力请求体（POST /capabilities）。status 不在此列：新行强制 disabled 落库。 */
export interface CreatePayload {
  capability_id: string;
  tool_name: string;
  scene: string;
  endpoint: string;
  tool_version: string;
  model_version: string;
  capability_type: CapabilityType;
  adapter_type: AdapterType;
  health_endpoint?: string | null;
  api_version?: string;
  timeout_s?: number;
  max_retry?: number;
  description?: string | null;
  meta?: Record<string, unknown>;
  change_reason: string;
  expected_snapshot?: string | null;
}

/** 字段级更新请求体（PATCH /capabilities/{id}）：capability_id / tool_name 锁死，不下发。 */
export interface PatchPayload {
  expected_version: number;
  change_reason: string;
  scene?: string;
  capability_type?: CapabilityType;
  adapter_type?: AdapterType;
  endpoint?: string | null;
  health_endpoint?: string | null;
  tool_version?: string;
  model_version?: string;
  api_version?: string;
  timeout_s?: number;
  max_retry?: number;
  description?: string | null;
  meta?: Record<string, unknown>;
  expected_snapshot?: string | null;
}

/* ---------------- 展示元数据 ---------------- */
/** 场景白名单（镜像后端 scene_catalog.SCENE_CATALOG 六键）；登记时 scene 必须落在此表内。 */
export const SCENE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'fpi', label: '荧光渗透检测' },
  { value: 'borescope', label: '孔探检测' },
  { value: 'infrared', label: '热部图像检测' },
  { value: 'dr', label: 'X射线检测' },
  { value: 'fracture', label: '断口分析' },
  { value: 'metallography', label: '金相分析' },
];
/** scene → 生命周期阶段（后端不下发，仅供能力中心排序/预设兜底展示）。 */
const SCENE_PHASE: Record<string, LifecyclePhase> = {
  fpi: 'manufacturing', borescope: 'in_service', infrared: 'testing',
  dr: 'manufacturing', fracture: 'maintenance', metallography: 'manufacturing',
};

export const PHASE_OPTIONS: Array<{ value: LifecyclePhase; label: string }> = [
  { value: 'design', label: '① 设计/仿真' },
  { value: 'manufacturing', label: '② 制造/加工' },
  { value: 'assembly', label: '③ 装配' },
  { value: 'testing', label: '④ 试验/试车' },
  { value: 'in_service', label: '⑤ 在役运维（孔探）' },
  { value: 'maintenance', label: '⑥ 修理/MRO' },
  { value: 'retirement', label: '⑦ 报废/回收' },
];
export const TYPE_OPTIONS: Array<{ value: CapabilityType; label: string }> = [
  { value: 'defect_detection', label: '缺陷检测' },
  { value: 'measurement', label: '测量' },
  { value: 'classification', label: '分类' },
];
export const ADAPTER_OPTIONS: Array<{ value: AdapterType; label: string }> = [
  { value: 'http', label: 'HTTP 算法工具' },
  { value: 'model_service', label: '模型服务' },
  { value: 'local_bridge', label: '本地软件桥接' },
  { value: 'mock', label: 'Mock 工具' },
];
export const STATUS_LABEL: Record<CapabilityStatus, string> = {
  enabled: '启用', disabled: '停用', maintenance: '维护中',
};

export const phaseLabel = (v: string) => PHASE_OPTIONS.find((o) => o.value === v)?.label ?? v;
export const typeLabel = (v: string) => TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v;
export const adapterLabel = (v: string) => ADAPTER_OPTIONS.find((o) => o.value === v)?.label ?? v;
export const sceneLabel = (v: string) => SCENE_OPTIONS.find((o) => o.value === v)?.label ?? v;

/* ---------------- 传输 ---------------- */
async function unwrap<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  if (res.status === 401) throw new Error('未登录或会话已失效');
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`quality-agent ${res.status} ${res.statusText} @ ${path}`);
  }
  if (!res.ok || (json && typeof json.code === 'number' && json.code !== 0)) {
    throw new Error(`quality-agent: ${json?.message || res.status} @ ${path}`);
  }
  return (json && typeof json === 'object' && 'result' in json ? json.result : json) as T;
}

interface PageResult<T> { items: T[]; meta?: { total: number; page: number; page_size: number } }

function normalize(s: CapabilitySummary): Capability {
  return {
    capability_id: s.capability_id,
    name: s.display_name || s.tool_name || s.capability_id,
    scene: s.scene,
    lifecycle_phase: SCENE_PHASE[s.scene] ?? 'manufacturing',
    capability_type: s.capability_type,
    adapter_type: s.adapter_type,
    endpoint: '',               // 摘要不含端点，编辑时经详情补齐
    tool_name: s.tool_name,
    description: s.note || '',
    parameters: {},
    status: s.status,
    version: 0,                 // 摘要不下发乐观锁水位，编辑前取详情
    tool_version: s.tool_version,
    model_version: s.model_version,
    note: s.note,
  };
}

const enc = encodeURIComponent;

/** 能力列表（GET /capabilities → 归一 Capability[]，兼容能力中心旧字段）。 */
export async function listCapabilities(params?: {
  scene?: string; enabled_only?: boolean;
}): Promise<Capability[]> {
  const q = new URLSearchParams();
  if (params?.scene) q.set('scene', params.scene);
  if (params?.enabled_only != null) q.set('enabled_only', String(params.enabled_only));
  const qs = q.toString();
  const data = await unwrap<PageResult<CapabilitySummary>>(`/capabilities${qs ? `?${qs}` : ''}`);
  return Array.isArray(data?.items) ? data.items.map(normalize) : [];
}

/** 能力详情（GET /capabilities/{id}）：编辑前取 version/snapshot/端点等完整字段。 */
export async function getCapabilityDetail(id: string): Promise<CapabilityDetail> {
  return unwrap<CapabilityDetail>(`/capabilities/${enc(id)}`);
}

/** 登记新能力（POST /capabilities）：新行以 disabled 落库，启用需另行启停并通过健康探测。 */
export async function createCapability(payload: CreatePayload): Promise<Record<string, unknown>> {
  return unwrap<Record<string, unknown>>('/capabilities', { method: 'POST', body: JSON.stringify(payload) });
}

/** 字段级更新（PATCH /capabilities/{id}）：带乐观锁 expected_version 与 change_reason。 */
export async function patchCapability(id: string, payload: PatchPayload): Promise<Record<string, unknown>> {
  return unwrap<Record<string, unknown>>(`/capabilities/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

/** 启停（POST /capabilities/{id}/status）：change_reason 必填；启用会先跑端点健康探测，不通则拒绝。 */
export async function setCapabilityStatus(
  id: string, status: CapabilityStatus, changeReason: string,
): Promise<Record<string, unknown>> {
  return unwrap<Record<string, unknown>>(`/capabilities/${enc(id)}/status`, {
    method: 'POST', body: JSON.stringify({ status, change_reason: changeReason }),
  });
}

/** 登记弹窗空白初值。 */
export function emptyCreate(): CreatePayload {
  return {
    capability_id: '', tool_name: '', scene: 'fpi', endpoint: '',
    tool_version: '1.0.0', model_version: '1.0.0',
    capability_type: 'defect_detection', adapter_type: 'http',
    api_version: 'v1', timeout_s: 60, max_retry: 2, description: '',
    meta: {}, change_reason: '',
  };
}
