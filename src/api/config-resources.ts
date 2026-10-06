/** 外部资源配置 API（基模 / RAGFlow / MinIO，对接 vision-agent 后端）
 *  统一信封 {code,message,result}；密钥字段后端返回掩码，回传掩码视为未改动。
 *  一个通用页面 + 三类描述符（字段/列/选项）驱动表单与表格，新增资源只需加描述符。 */

const BASE = import.meta.env.VITE_QA_API_BASE || '/api/v1';

export type ResourceKind = 'llm' | 'ragflow' | 'storage';
export type ConfigStatus = 'enabled' | 'disabled';

export interface ConfigRow {
  [k: string]: unknown;
  status: ConfigStatus;
  version: number;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

/** 字段描述：驱动注册弹窗的表单项。 */
export interface FieldDef {
  key: string;
  label: string;
  input: 'text' | 'textarea' | 'select' | 'number' | 'switch' | 'secret';
  required?: boolean;
  isPk?: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  hint?: string;
}
/** 列描述：驱动表格列与 bodyCell 渲染。 */
export interface ColumnDef {
  key: string;
  title: string;
  width?: number;
  ellipsis?: boolean;
  render?: 'id' | 'text' | 'secret' | 'status' | 'default';
  labelMap?: Record<string, string>;
}

export interface ResourceDescriptor {
  kind: ResourceKind;
  path: string;         // 后端资源路径段
  pk: string;           // 主键字段名
  title: string;
  subtitle: string;
  createText: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  defaults(): ConfigRow;
}

const STATUS_OPTIONS = [{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }];

export const PROVIDER_KIND_OPTIONS = [
  { value: 'openai_compatible', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'dashscope', label: 'DashScope' },
];

export const DESCRIPTORS: Record<ResourceKind, ResourceDescriptor> = {
  llm: {
    kind: 'llm', path: 'llm-providers', pk: 'provider_id',
    title: '基模供应商配置', subtitle: '登记大模型 / 视觉模型服务；生效行供报告解读与智能体调用，API Key 落库自动加密。',
    createText: '+ 注册基模',
    columns: [
      { key: 'provider_id', title: '名称', width: 200, render: 'id' },
      { key: 'provider_kind', title: '协议', width: 120, render: 'text', labelMap: { openai_compatible: 'OpenAI 兼容', anthropic: 'Anthropic', dashscope: 'DashScope' } },
      { key: 'base_url', title: '服务地址', ellipsis: true },
      { key: 'model_name', title: '模型', width: 160 },
      { key: 'api_key', title: 'API Key', width: 120, render: 'secret' },
      { key: 'status', title: '状态', width: 90, render: 'status' },
      { key: 'is_default', title: '生效', width: 80, render: 'default' },
    ],
    fields: [
      { key: 'provider_id', label: '配置 ID', input: 'text', required: true, isPk: true, placeholder: '如 default-openai' },
      { key: 'display_name', label: '展示名', input: 'text', placeholder: '如 通义千问生产网关' },
      { key: 'provider_kind', label: '协议类型', input: 'select', options: PROVIDER_KIND_OPTIONS },
      { key: 'base_url', label: '服务地址', input: 'text', placeholder: 'https://dashscope.../compatible-mode/v1' },
      { key: 'model_name', label: '文本模型名', input: 'text', placeholder: '如 qwen-plus' },
      { key: 'vlm_model', label: '视觉模型名', input: 'text', placeholder: '如 qwen-vl-max' },
      { key: 'api_key', label: 'API Key', input: 'secret', hint: '保存后自动加密；编辑时留空/掩码表示不修改' },
      { key: 'temperature', label: '采样温度', input: 'number', placeholder: '0.0 ~ 2.0' },
      { key: 'max_tokens', label: '最大 token', input: 'number' },
      { key: 'is_default', label: '设为生效行', input: 'switch' },
    ],
    defaults: () => ({ provider_id: '', display_name: '', provider_kind: 'openai_compatible', base_url: '', model_name: '', vlm_model: '', api_key: '', temperature: null, max_tokens: null, is_default: false, status: 'enabled', version: 1 }),
  },
  ragflow: {
    kind: 'ragflow', path: 'ragflow-connections', pk: 'connection_id',
    title: 'RAGFlow 知识库连接', subtitle: '登记服务器上的 RAGFlow 实例；base_url 不带 /api/v1，API Key 落库自动加密。',
    createText: '+ 注册连接',
    columns: [
      { key: 'connection_id', title: '名称', width: 200, render: 'id' },
      { key: 'base_url', title: 'Base URL', ellipsis: true },
      { key: 'api_key', title: 'API Key', width: 130, render: 'secret' },
      { key: 'rerank_model', title: '重排模型', width: 160 },
      { key: 'status', title: '状态', width: 90, render: 'status' },
      { key: 'is_default', title: '生效', width: 80, render: 'default' },
    ],
    fields: [
      { key: 'connection_id', label: '连接 ID', input: 'text', required: true, isPk: true, placeholder: '如 default' },
      { key: 'name', label: '展示名', input: 'text', placeholder: '如 服务器生产库' },
      { key: 'base_url', label: 'Base URL', input: 'text', required: true, placeholder: 'http://182.92.121.228:8080' },
      { key: 'api_key', label: 'API Key', input: 'secret', hint: 'ragflow-xxxx；保存后自动加密' },
      { key: 'rerank_model', label: '重排模型', input: 'text', placeholder: '如 bge-reranker-v2-m3，留空跳过' },
      { key: 'chat_config_path', label: '对话参数配置路径', input: 'text', placeholder: './config/rules/ragflow_chat.yaml' },
      { key: 'is_default', label: '设为生效行', input: 'switch' },
    ],
    defaults: () => ({ connection_id: '', name: '', base_url: '', api_key: '', rerank_model: '', chat_config_path: './config/rules/ragflow_chat.yaml', is_default: false, status: 'enabled', version: 1 }),
  },
  storage: {
    kind: 'storage', path: 'storage-endpoints', pk: 'endpoint_id',
    title: 'MinIO 存储端点', subtitle: '登记对象存储端点；endpoint 不带 http://，Access/Secret Key 落库自动加密。',
    createText: '+ 注册端点',
    columns: [
      { key: 'endpoint_id', title: '名称', width: 180, render: 'id' },
      { key: 'endpoint', title: 'Endpoint', ellipsis: true },
      { key: 'bucket', title: '桶', width: 180 },
      { key: 'secret_key', title: 'Secret', width: 120, render: 'secret' },
      { key: 'status', title: '状态', width: 90, render: 'status' },
      { key: 'is_default', title: '生效', width: 80, render: 'default' },
    ],
    fields: [
      { key: 'endpoint_id', label: '端点 ID', input: 'text', required: true, isPk: true, placeholder: '如 default-minio' },
      { key: 'name', label: '展示名', input: 'text', placeholder: '如 服务器 MinIO' },
      { key: 'endpoint', label: 'Endpoint (host:port)', input: 'text', required: true, placeholder: '182.92.121.228:9000' },
      { key: 'access_key', label: 'Access Key', input: 'secret', hint: '保存后自动加密' },
      { key: 'secret_key', label: 'Secret Key', input: 'secret', hint: '保存后自动加密' },
      { key: 'bucket', label: '桶名', input: 'text', placeholder: 'vision-media-assets' },
      { key: 'region', label: '区域', input: 'text', placeholder: '可留空' },
      { key: 'presign_ttl_seconds', label: '预签 URL 有效期(秒)', input: 'number', placeholder: '86400' },
      { key: 'secure', label: '使用 HTTPS', input: 'switch' },
      { key: 'is_default', label: '设为生效行', input: 'switch' },
    ],
    defaults: () => ({ endpoint_id: '', name: '', endpoint: '', access_key: '', secret_key: '', bucket: 'vision-media-assets', region: '', presign_ttl_seconds: 86400, secure: false, is_default: false, status: 'enabled', version: 1 }),
  },
};

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
    throw new Error(`vision-agent ${res.status} ${res.statusText} @ ${path}`);
  }
  if (!res.ok || (json && typeof json.code === 'number' && json.code !== 0)) {
    throw new Error(`vision-agent: ${json?.message || res.status} @ ${path}`);
  }
  return (json && typeof json === 'object' && 'result' in json ? json.result : json) as T;
}

interface PageResult<T> { items: T[]; meta: { total: number; page: number; page_size: number } }

export async function listResources(kind: ResourceKind): Promise<ConfigRow[]> {
  const d = DESCRIPTORS[kind];
  const data = await unwrap<PageResult<ConfigRow>>(`/${d.path}?page=1&page_size=100`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function saveResource(kind: ResourceKind, row: ConfigRow, editing: boolean): Promise<ConfigRow> {
  const d = DESCRIPTORS[kind];
  const id = String(row[d.pk]);
  if (editing) return unwrap<ConfigRow>(`/${d.path}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(row) });
  return unwrap<ConfigRow>(`/${d.path}`, { method: 'POST', body: JSON.stringify(row) });
}

export async function setResourceStatus(kind: ResourceKind, id: string, status: ConfigStatus): Promise<unknown> {
  return unwrap(`/${DESCRIPTORS[kind].path}/${encodeURIComponent(id)}/status?status=${status}`, { method: 'PATCH' });
}

export async function setResourceDefault(kind: ResourceKind, id: string): Promise<unknown> {
  return unwrap(`/${DESCRIPTORS[kind].path}/${encodeURIComponent(id)}/default`, { method: 'PATCH' });
}

export async function deleteResource(kind: ResourceKind, id: string): Promise<unknown> {
  return unwrap(`/${DESCRIPTORS[kind].path}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export { STATUS_OPTIONS };
