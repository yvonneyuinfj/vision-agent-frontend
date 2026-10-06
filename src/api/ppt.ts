/** 文档生成 API（能力中心 · PPT 制作）：/api/v1/documents/*，经同源 /api 代理转发。
 *  对齐后端 app/api/v1/document.py；统一信封 {code,message,result}，
 *  code!==0 / 401 / 非 2xx 抛错。产物下载复用既有 /api/v1/tasks/{id}/files/{name} 安全路由。 */

const BASE = import.meta.env.VITE_QA_API_BASE || '/api/v1';

export type DocStatus = 'pending' | 'running' | 'completed' | 'failed';

/** 自定义大纲的一节：heading 为页标题，bullets 为该页要点。 */
export interface PptSection {
  heading: string;
  bullets: string[];
}

/** 自定义大纲（传则后端跳过 LLM，直接按此渲染）。 */
export interface PptOutline {
  title?: string;
  subtitle?: string;
  sections: PptSection[];
  closing?: string;
}

export interface PptSubmitForm {
  topic: string;
  audience?: string;
  pages?: number;
  style?: string;
  request?: string;
  materials?: File[];
  outline?: PptOutline;
  template?: File | null;
}

export interface DocumentResult {
  task_id: string;
  status: DocStatus;
  artifact_uri?: string;
  filename?: string;
  slide_count?: number;
  engine?: 'llm' | 'template' | 'manual';
  material_notes?: string[];
  error?: string;
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

export async function submitPpt(form: PptSubmitForm): Promise<{ task_id: string; status: DocStatus }> {
  const fd = new FormData();
  fd.append('topic', form.topic);
  if (form.audience) fd.append('audience', form.audience);
  if (form.pages != null) fd.append('pages', String(form.pages));
  if (form.style) fd.append('style', form.style);
  if (form.request) fd.append('request', form.request);
  for (const f of form.materials ?? []) fd.append('materials', f);
  if (form.outline && form.outline.sections.length) fd.append('outline_json', JSON.stringify(form.outline));
  if (form.template) fd.append('template', form.template);
  return qaFetch('/documents/ppt', { method: 'POST', body: fd });
}

export async function fetchDocument(taskId: string): Promise<DocumentResult> {
  return qaFetch<DocumentResult>(`/documents/${encodeURIComponent(taskId)}`);
}

/** 产物下载 URL：后端 artifact_uri 已是 /api/v1/tasks/{id}/files/{name}?kind=artifacts 绝对路径，直接透传。 */
export function documentDownloadUrl(artifactUri: string): string {
  return artifactUri;
}
