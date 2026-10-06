/** quality-agent 登录鉴权 API（/api/v1/auth/*，经同源 /api 代理转发）
 *  auth 前缀在服务器侧豁免登录校验，故 me/login 未登录也可调用；
 *  登录成功后服务端签发 httpOnly 会话 Cookie，后续业务请求自动携带。 */

const BASE = import.meta.env.VITE_QA_API_BASE || '/api/v1';

export interface AuthUser {
  logged_in: boolean;
  username: string;
}

async function authFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`认证服务异常 ${res.status} @ ${path}`);
  }
  // 平台信封：登录失败回 HTTP 401 + code 401；非 2xx 或 code!==0 均抛错
  if (!res.ok || (json && typeof json.code === 'number' && json.code !== 0)) {
    throw new Error(json?.message || `认证失败 ${res.status} @ ${path}`);
  }
  return (json && typeof json === 'object' && 'result' in json ? json.result : json) as T;
}

/** 当前登录态（不要求登录即可调用；前端据此决定是否跳登录页）。 */
export async function fetchMe(): Promise<AuthUser> {
  const r = await authFetch<Partial<AuthUser>>('/auth/me');
  return { logged_in: !!r?.logged_in, username: String(r?.username ?? '') };
}

export async function loginApi(username: string, password: string): Promise<AuthUser> {
  const r = await authFetch<Partial<AuthUser>>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return { logged_in: !!r?.logged_in, username: String(r?.username ?? username) };
}

export async function logoutApi(): Promise<void> {
  // 登出失败不阻断前端清理本地登录态
  try {
    await authFetch('/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
}
