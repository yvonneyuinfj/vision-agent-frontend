/** quality-agent 任务中心 API（/api/v1/tasks/*，经同源 /api 代理转发）
 *  对齐后端 app/api/v1/task.py 与 app/api/schemas/task.py；统一信封 {code,message,result}，
 *  code!==0 / 401 / 非 2xx 抛错。场景/状态用后端英文码，交由 data/scene-map 映射到展示层。 */

const BASE = import.meta.env.VITE_QA_API_BASE || '/api/v1';

export type QaTaskStatus =
  | 'pending' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'canceled';
export type QaMode = 'single' | 'joint' | 'agent' | 'document';
export type ReviewAction = 'confirm' | 'revise' | 'requeue' | 'reject';

export interface QaTaskSummary {
  task_id: string;
  scene: string | null;
  mode: QaMode;
  status: QaTaskStatus;
  capability_used: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  parent_task_id?: string | null;
  image_count?: number;
}

export interface QaDefectItem {
  defect_id: string | null;
  defect_type: string;
  defect_name_cn: string;
  confidence: number | null;
  severity: 'low' | 'medium' | 'high' | null;
  location: { type?: string; bbox?: number[]; bbox_xyxy?: number[] } | null;
  description?: string;
  source?: 'model' | 'manual' | 'agent_visual';
  human_rejected?: boolean;
  image_name?: string;
}

export interface QaGradeInfo { level: string; summary: string; [k: string]: unknown }

export interface QaReportRef {
  report_type: string;
  name: string;
  uri: string;
  version: string;
  analysis_lead?: string;
  artifacts?: Array<{ name: string; mime: string | null; uri: string }>;
}

export interface QaTaskDetail extends QaTaskSummary {
  trace_id: string | null;
  input_uris: string[];
  steps: Array<{ node: string; message: string; ts: string }>;
  standardized: QaDefectItem[];
  class_definitions?: unknown[];
  grade: QaGradeInfo | null;
  knowledge: Array<{ content: string; score: number; doc_name: string; chunk_id: string | null }>;
  review: { action: string; opinion: string; reviewed_at?: string | null } | null;
  report: QaReportRef | null;
  error: { node: string; code: number; message: string } | null;
  children?: QaTaskSummary[];
}

export interface QaTaskStats {
  total: number;
  today: number;
  pending: number;
  running: number;
  awaiting_review: number;
  completed: number;
  failed: number;
  canceled: number;
}

export interface ReviewPayload {
  action: ReviewAction;
  opinion: string;
  override_grade?: Partial<QaGradeInfo> | null;
  defects?: QaDefectItem[] | null;
}

async function qaFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
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

export interface SubmitTaskForm {
  scene: string | null;
  mode: QaMode;
  scenes: string[];
  files: File[];
  parameters?: Record<string, unknown> | null;
}

function buildFormData(form: SubmitTaskForm): FormData {
  const fd = new FormData();
  for (const f of form.files) fd.append('files', f);
  if (form.mode === 'single' && form.scene) fd.append('scene', form.scene);
  fd.append('mode', form.mode);
  if (form.mode === 'joint') fd.append('scenes', form.scenes.join(','));
  if (form.parameters && Object.keys(form.parameters).length) {
    fd.append('parameters', JSON.stringify(form.parameters));
  }
  return fd;
}

export async function submitTask(form: SubmitTaskForm): Promise<{ task_id: string; mode: string }> {
  return qaFetch('/tasks', { method: 'POST', body: buildFormData(form) });
}

interface PageResult<T> { items: T[]; meta: { total: number; page: number; page_size: number } }

export async function fetchTaskList(params?: {
  scene?: string; status?: QaTaskStatus; limit?: number;
}): Promise<QaTaskSummary[]> {
  const q = new URLSearchParams();
  if (params?.scene) q.set('scene', params.scene);
  if (params?.status) q.set('status', params.status);
  q.set('limit', String(params?.limit ?? 100));
  const data = await qaFetch<PageResult<QaTaskSummary>>(`/tasks?${q.toString()}`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchTaskStats(): Promise<QaTaskStats> {
  return qaFetch<QaTaskStats>('/tasks/stats');
}

export async function fetchTaskDetail(taskId: string): Promise<QaTaskDetail> {
  return qaFetch<QaTaskDetail>(`/tasks/${encodeURIComponent(taskId)}`);
}

export async function reviewTask(taskId: string, body: ReviewPayload): Promise<unknown> {
  return qaFetch(`/tasks/${encodeURIComponent(taskId)}/review`, {
    method: 'POST',
    body: JSON.stringify({
      action: body.action,
      opinion: body.opinion ?? '',
      override_grade: body.override_grade ?? null,
      defects: body.defects ?? null,
    }),
  });
}

export async function retryTask(taskId: string): Promise<{ task_id: string }> {
  return qaFetch(`/tasks/${encodeURIComponent(taskId)}/retry`, { method: 'POST' });
}

/** 从后端 input_uri（形如 /api/v1/tasks/{id}/files/{name}?kind=inputs）取文件名。 */
export function fileNameFromUri(uri: string): string {
  try {
    const u = new URL(uri, window.location.origin);
    const last = u.pathname.split('/').pop() || '';
    return decodeURIComponent(last);
  } catch {
    const base = uri.split('?')[0].split('/').pop() || '';
    return decodeURIComponent(base);
  }
}

/** 报告正文（GET /reports/{task_id}）：meta = 报告元信息，content = markdown 正文。 */
export interface QaReportBody {
  meta: { task_id: string; report_uri: string; format: string; generated_at: string };
  content: string;
}

export async function fetchReport(taskId: string): Promise<QaReportBody> {
  return qaFetch<QaReportBody>(`/reports/${encodeURIComponent(taskId)}`);
}

/** 拼接安全的文件下载 URL（kind 白名单：inputs/artifacts/reports）。 */
export function downloadTaskFile(taskId: string, name: string, kind: 'inputs' | 'artifacts' | 'reports'): string {
  return `/api/v1/tasks/${encodeURIComponent(taskId)}/files/${encodeURIComponent(name)}?kind=${kind}`;
}

/** 文档（PPT）任务轮询结果（GET /documents/{task_id}）；完成后携产物下载 URI。 */
export interface QaDocumentResult {
  task_id: string;
  status: string;
  artifact_uri?: string;
  filename?: string;
  slide_count?: number;
  engine?: string;
  material_notes?: string[];
  error?: string;
}

export async function fetchDocument(taskId: string): Promise<QaDocumentResult> {
  return qaFetch<QaDocumentResult>(`/documents/${encodeURIComponent(taskId)}`);
}
