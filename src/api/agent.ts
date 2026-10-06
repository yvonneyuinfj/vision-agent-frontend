/** quality-agent 智能视觉助手会话 API（/api/v1/agent/sessions/*，经同源 /api 代理转发）
 *  鉴权与后端密钥都在服务端;前端只持有 httpOnly 会话 Cookie。
 *  统一响应外壳 {code, message, result};code!==0 或 HTTP 非 2xx 抛错。
 *  消息流为 SSE:GET /sessions/{id}/stream,顶层 type 决定渲染(message/thinking/chain/card)。 */

const BASE = import.meta.env.VITE_QA_API_BASE || '/api/v1';

/* ---------------- 会话 ---------------- */
export interface AgentSession {
  session_id: string;
  title: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  last_message?: string | null;
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

export async function listSessions(): Promise<AgentSession[]> {
  return qaFetch<AgentSession[]>('/agent/sessions');
}

export async function createSession(title?: string | null): Promise<AgentSession> {
  return qaFetch<AgentSession>('/agent/sessions', {
    method: 'POST',
    body: JSON.stringify({ title: title ?? null }),
  });
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  await qaFetch(`/agent/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await qaFetch(`/agent/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

/* ---------------- 消息发送(multipart,可带图片) ---------------- */
/** scene 为显式指定的后端场景码(如 infrared/dr)：随表单提交，后端命中候选池时直接采用、跳过 VLM 路由。 */
export async function sendMessage(
  sessionId: string,
  content: string,
  files: File[] = [],
  scene = '',
): Promise<void> {
  const form = new FormData();
  form.append('content', content);
  if (scene) form.append('scene', scene);
  for (const f of files) form.append('files', f);
  await qaFetch(`/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: form,
  });
}

/* ---------------- 消息流(SSE) ---------------- */
/** 后端流式协议帧(顶层 type 分派)。 */
export type StreamFrame =
  | { type: 'message'; message_id: string; phase: 'start' | 'delta' | 'end'; delta?: string; message?: { role: string; kind: string; content?: string; images?: string[] }; task_id?: string | null }
  | { type: 'thinking'; message_id: string; phase: 'start' | 'delta' | 'end'; delta?: string; text?: string; turn?: number; task_id?: string | null }
  | { type: 'chain'; event: 'tool_call' | 'tool_result'; message_id: string; name?: string; args?: any; content?: any; done?: boolean; is_error?: boolean; call_id?: string; turn?: number; task_id?: string | null }
  | { type: 'card'; card_type: string; message_id: string; task_id?: string | null; payload: any }
  | { type: 'error'; message?: string };

export interface StreamHandlers {
  onFrame: (frame: StreamFrame) => void;
  onError?: (err: Error) => void;
  onOpen?: () => void;
}

/** 打开某会话的消息流;返回一个 close() 用于中止(切换会话/卸载时)。
 *  首帧为全量历史回放(整帧),此后近零延迟推新增;心跳 `: ping` 忽略。 */
export function streamMessages(sessionId: string, h: StreamHandlers): () => void {
  const ctrl = new AbortController();
  let opened = false;

  (async () => {
    try {
      const res = await fetch(`${BASE}/agent/sessions/${encodeURIComponent(sessionId)}/stream`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'text/event-stream' },
        signal: ctrl.signal,
      });
      if (res.status === 401) throw new Error('未登录或会话已失效');
      if (!res.ok || !res.body) throw new Error(`消息流建立失败 ${res.status}`);
      if (!opened) { opened = true; h.onOpen?.(); }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE 帧以空行分隔;逐帧解析 data: 行
        let sep: number;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const rawFrame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of rawFrame.split('\n')) {
            const s = line.trim();
            if (!s.startsWith('data:')) continue; // 忽略 `: ping` 心跳与注释
            const payload = s.slice(5).trim();
            if (!payload) continue;
            try {
              h.onFrame(JSON.parse(payload) as StreamFrame);
            } catch {
              /* 跳过无法解析的分片 */
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // 主动关闭,不算错误
      h.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return () => ctrl.abort();
}
