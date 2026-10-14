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
  /** 人工修订时的原值快照（改类/改严重度/移框前的 before 值），供审计与报告叙述 */
  revised?: Record<string, unknown> | null;
  /** 存量非规范条目可能只落以下字段而无 defect_type（热部链路 / 分类结果族）：
   *  复核工作台播种时按 type → label → class_name → name → code 归一到 defect_type。 */
  type?: string;
  label?: string;
  class_name?: string;
}

export interface QaGradeInfo { level: string; summary: string; [k: string]: unknown }

/** 推理产物引用（业务 URI，可直接作 img src / 下载）：
 *  复核期来自 review.artifacts（中断载荷），终局后来自 report.artifacts。 */
export interface QaArtifactRef {
  name: string;
  mime: string | null;
  uri: string;
}

/** 工具类别定义表（class_id/class_name/description/is_true_defect）：改类下拉候选与语义转译。 */
export interface QaClassDef {
  class_id?: string | number | null;
  class_name?: string;
  description?: string;
  is_true_defect?: boolean | null;
  [k: string]: unknown;
}

/** review 通道双语义（同名字段互斥，按有无 action 区分）：
 *  1) 复核门中断载荷 —— question / grade / candidates / confirm_type / artifacts，
 *     等待人工决定；2) 已提交的人工决定 —— action / opinion / grading_result / reviewed_at。
 *  注意 confirm_type==='scene' 的中断不是判级复核，须走 /scene-confirm 恢复。 */
export interface QaReviewInfo {
  action?: string;
  opinion?: string;
  reviewed_at?: string | null;
  grading_result?: string;
  question?: string;
  confirm_type?: string;
  candidates?: Array<{ scene: string; confidence?: number | null; [k: string]: unknown }>;
  grade?: QaGradeInfo | null;
  standardized_count?: number;
  knowledge_count?: number;
  artifacts?: QaArtifactRef[];
  decision_options?: string[];
  defects_diff?: Record<string, number>;
  [k: string]: unknown;
}

export interface QaReportRef {
  report_type: string;
  name: string;
  uri: string;
  version: string;
  analysis_lead?: string;
  artifacts?: QaArtifactRef[];
}

export interface QaTaskDetail extends QaTaskSummary {
  trace_id: string | null;
  input_uris: string[];
  steps: Array<{ node: string; message: string; ts: string }>;
  standardized: QaDefectItem[];
  class_definitions?: QaClassDef[];
  grade: QaGradeInfo | null;
  knowledge: Array<{ content: string; score: number; doc_name: string; chunk_id: string | null }>;
  review: QaReviewInfo | null;
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

/** 场景人工确认（多候选歧义恢复）：后端 review_task 对 confirm_type=scene 的任务
 *  会 409 拒绝，必须走本端点；scene 必须是待确认候选之一，否则 400。 */
export async function confirmScene(
  taskId: string, scene: string, opinion = '',
): Promise<{ task_id: string; scene: string }> {
  return qaFetch(`/tasks/${encodeURIComponent(taskId)}/scene-confirm`, {
    method: 'POST',
    body: JSON.stringify({ scene, opinion }),
  });
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
