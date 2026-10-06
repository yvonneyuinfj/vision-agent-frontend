/** 前端登录态(仅远程模式 VITE_QA_ENABLED=true 生效)
 *  会话由服务端 httpOnly Cookie 承载,前端只缓存"是否已登录 + 用户名"用于路由守卫与顶栏展示。
 *  演示模式(未开启远程)下视为始终已登录,不触发任何鉴权。 */
import { reactive } from 'vue';
import { ragflowEnabled } from '@/api/ragflow';
import { fetchMe, loginApi, logoutApi } from '@/api/auth';

export const auth = reactive({
  /** 是否已完成首次 /auth/me 探测(避免每次导航都重复请求) */
  checked: false,
  logged_in: false,
  username: '',
});

/** 探测登录态;仅远程模式且未探测过时发一次请求。失败按未登录处理。 */
export async function ensureSession(): Promise<void> {
  if (!ragflowEnabled) {
    auth.checked = true;
    auth.logged_in = true;
    return;
  }
  if (auth.checked) return;
  try {
    const me = await fetchMe();
    auth.logged_in = me.logged_in;
    auth.username = me.username;
  } catch {
    auth.logged_in = false;
    auth.username = '';
  } finally {
    auth.checked = true;
  }
}

/** 登录;成功后刷新登录态(错误由调用方捕获展示)。 */
export async function login(username: string, password: string): Promise<void> {
  const u = await loginApi(username, password);
  auth.logged_in = true;
  auth.username = u.username;
  auth.checked = true;
}

/** 登出;清除服务端会话 Cookie 并复位本地登录态。 */
export async function logout(): Promise<void> {
  await logoutApi();
  auth.logged_in = false;
  auth.username = '';
}
