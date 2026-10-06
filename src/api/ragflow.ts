/** quality-agent 平台 API 客户端
 *  经同源 /api 代理转发到 FastAPI 后端;鉴权与 RAGFlow 密钥都在服务端,前端不再接触。
 *  统一响应外壳 {code, message, result};code!==0 或 HTTP 非 2xx 抛错,由上层回退本地演示。 */
import type { IngestDoc, KnowledgeBase, TraceItem } from '@/data/knowledge';

const BASE = import.meta.env.VITE_QA_API_BASE || '/api/v1';
export const ragflowEnabled = import.meta.env.VITE_QA_ENABLED === 'true';

const AUTH_HINT = '未登录或会话已失效(quality-agent 默认需登录;本地调试可设 AUTH_ENABLED=false)';

const asArray = (d: any): any[] => (Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : []);

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
  if (res.status === 401) throw new Error(AUTH_HINT);
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`quality-agent ${res.status} ${res.statusText} @ ${path}`);
  }
  // 平台信封:code!==0 或 HTTP 非 2xx(503 未配置/404 缺失)均视为失败
  if (!res.ok || (json && typeof json.code === 'number' && json.code !== 0)) {
    throw new Error(`quality-agent: ${json?.message || res.status} @ ${path}`);
  }
  return (json && typeof json === 'object' && 'result' in json ? json.result : json) as T;
}

/* ---------- 系统状态(可选,用于连接指示) ---------- */
export interface RagStatus {
  configured: boolean; reachable: boolean; doc_count: number;
  latest_doc_time: string | null; message: string;
}
export async function getStatus(): Promise<RagStatus> {
  return qaFetch<RagStatus>('/ragflow/status');
}

/* ---------- 知识库列表 GET /ragflow/chat/datasets ---------- */
export async function listDatasets(): Promise<KnowledgeBase[]> {
  const data = await qaFetch<any[]>('/ragflow/chat/datasets');
  return asArray(data).map((d) => ({
    id: String(d.id ?? ''),
    name: String(d.name ?? '未命名知识库'),
    docs: Number(d.document_count ?? d.doc_count ?? 0) || 0,
  })).filter((k) => k.id);
}

/* ---------- 会话(sessions,平台管理 chat_id) ---------- */
export interface QaSession { id: string; name: string; createTime: number }

export async function listSessions(): Promise<QaSession[]> {
  const data = await qaFetch<any[]>('/ragflow/chat/sessions');
  return asArray(data).map((s) => ({
    id: String(s.id ?? ''),
    name: String(s.name ?? '未命名会话'),
    createTime: Number(s.create_time ?? s.update_time ?? 0) || Date.now(),
  })).filter((s) => s.id);
}

export async function createSession(name: string): Promise<QaSession> {
  const d = await qaFetch<any>('/ragflow/chat/sessions', { method: 'POST', body: JSON.stringify({ name }) });
  return { id: String(d?.id ?? ''), name: String(d?.name ?? name), createTime: Date.now() };
}

export async function renameSession(id: string, name: string): Promise<void> {
  await qaFetch(`/ragflow/chat/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export async function deleteSession(id: string): Promise<void> {
  await qaFetch(`/ragflow/chat/sessions/${id}`, { method: 'DELETE' });
}

/** 会话历史消息(RAGFlow 形态:可能是 {role,content} 或 {question,answer}) */
export async function getSessionMessages(id: string): Promise<any[]> {
  const d = await qaFetch<any>(`/ragflow/chat/sessions/${id}`);
  return asArray(d?.messages ?? d);
}

/* ---------- 引用映射 ---------- */
function mapChunks(reference: any): TraceItem[] {
  const chunks = asArray(reference?.chunks ?? reference);
  return chunks.slice(0, 8).map((c) => {
    const score = Number(c.similarity ?? c.score ?? c.term_similarity ?? c.vector_similarity ?? 0);
    const content = String(c.content ?? c.content_ltks ?? c.content_with_weight ?? '').replace(/\s+/g, ' ').trim();
    const doc = String(c.document_keyword ?? c.document_name ?? c.docnm_kwd ?? '知识库文档');
    return {
      chunkId: String(c.chunk_id ?? c.id ?? ''),
      source: doc,
      snippet: content.length > 64 ? content.slice(0, 64) + '…' : content || '（无文本片段）',
      score: Math.max(0, Math.min(1, score)),
    };
  });
}

/* ---------- 流式问答(SSE 透传 RAGFlow 原生帧) ---------- */
export interface StreamHandlers {
  onDelta: (text: string) => void;
  onTrace: (trace: TraceItem[]) => void;
  onMeta?: (info: { sessionId?: string; messageId?: string }) => void;
}

export async function streamCompletion(
  sessionId: string,
  question: string,
  messageId: string,
  h: StreamHandlers,
): Promise<void> {
  const res = await fetch(`${BASE}/ragflow/chat/sessions/${encodeURIComponent(sessionId)}/completions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ question, message_id: messageId }),
  });
  if (res.status === 401) throw new Error(AUTH_HINT);
  if (!res.ok || !res.body) {
    let msg = `quality-agent ${res.status} ${res.statusText}`;
    try { msg = (await res.json())?.message || msg; } catch { /* 保留默认文案 */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  const feed = (frame: string) => {
    const line = frame.split('\n').find((l) => l.startsWith('data:'));
    if (!line) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let json: any;
    try { json = JSON.parse(payload); } catch { return; }
    // 业务错误帧(如 {code:4005,...}):平台在流内收口
    if (json && typeof json.code === 'number' && json.code !== 0) {
      throw new Error(json.message || `对话中断(code=${json.code})`);
    }
    const d = json.data ?? json;
    if (d.answer) h.onDelta(String(d.answer));
    const ref = d.reference;
    if (ref) {
      const t = mapChunks(ref.chunks ?? ref);
      if (t.length) h.onTrace(t);
    }
    if (d.id || d.session_id) h.onMeta?.({ sessionId: d.session_id, messageId: d.id });
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      feed(frame);
    }
  }
  if (buf.trim()) feed(buf);
}

/* ---------- 资料入库(平台补的写端点) ---------- */
const runToStatus = (run: any): IngestDoc['status'] => {
  const r = String(run).toUpperCase();
  if (r === '3' || r === 'DONE') return '已解析';
  if (r === '1' || r === 'RUNNING') return '解析中';
  return '待入库';  // 0/UNSTART、2/CANCEL 等一律待入库
};
const fmtTime = (v: any): string => {
  if (v == null || v === '') return '';
  const s = typeof v === 'number' ? new Date(v > 1e12 ? v : v * 1000) : new Date(String(v));
  if (Number.isNaN(s.getTime())) return String(v ?? '');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(s.getMonth() + 1)}-${pad(s.getDate())} ${pad(s.getHours())}:${pad(s.getMinutes())}`;
};

export async function listDocuments(datasetId: string): Promise<IngestDoc[]> {
  const data = await qaFetch<any[]>(`/ragflow/datasets/${datasetId}/documents`);
  return asArray(data).map((d) => ({
    id: String(d.id ?? ''),
    name: String(d.name ?? '未命名文件'),
    kbId: datasetId,
    type: String(d.suffix ?? (String(d.name || '').split('.').pop() || '文件')).toUpperCase(),
    size: `${(Number(d.size ?? 0) / 1024 / 1024).toFixed(1)} MB`,
    status: runToStatus(d.run ?? d.status),
    updatedAt: fmtTime(d.update_time ?? d.create_time),
  })).filter((x) => x.id);
}

export async function uploadDocuments(datasetId: string, files: File[]): Promise<void> {
  const form = new FormData();
  for (const f of files) form.append('files', f); // 字段名对齐 FastAPI 参数 list[UploadFile] files
  await qaFetch(`/ragflow/datasets/${datasetId}/documents`, { method: 'POST', body: form });
}

export async function parseDocuments(datasetId: string, documentIds: string[]): Promise<void> {
  await qaFetch(`/ragflow/datasets/${datasetId}/chunks`, {
    method: 'POST',
    body: JSON.stringify({ document_ids: documentIds }),
  });
}

/* ---------- 文档预览 / 解析文本 / 下载(需后端已部署预览端点) ---------- */
export interface DocChunk { chunkId: string; content: string; imageId: string }

/** 内联预览 URL:交给 <iframe>/<img>,服务端代理原文,密钥不下发浏览器 */
export function buildPreviewUrl(documentId: string, name: string): string {
  return `${BASE}/ragflow/documents/${encodeURIComponent(documentId)}/content?name=${encodeURIComponent(name)}`;
}
/** 分块内嵌图片代理 URL */
export function buildImageUrl(imageId: string): string {
  return `${BASE}/ragflow/images/${encodeURIComponent(imageId)}`;
}

export async function fetchDocumentChunks(datasetId: string, documentId: string): Promise<DocChunk[]> {
  const data = await qaFetch<any>(
    `/ragflow/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks`,
  );
  return asArray(data?.chunks ?? data).map((c) => ({
    chunkId: String(c.chunk_id ?? c.id ?? ''),
    content: String(c.content ?? ''),
    imageId: String(c.image_id ?? ''),
  }));
}

function parseDispositionName(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) { try { return decodeURIComponent(star[1]); } catch { /* 保留兜底名 */ } }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
}

export async function downloadDocument(datasetId: string, documentId: string, fallbackName: string): Promise<void> {
  const res = await fetch(
    `${BASE}/ragflow/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/file`,
    { credentials: 'include' },
  );
  if (res.status === 401) throw new Error(AUTH_HINT);
  if (!res.ok) {
    let msg = `下载失败 ${res.status}`;
    try { msg = (await res.json())?.message || msg; } catch { /* 非 JSON 兜底 */ }
    throw new Error(msg);
  }
  const name = parseDispositionName(res.headers.get('content-disposition'), fallbackName);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
