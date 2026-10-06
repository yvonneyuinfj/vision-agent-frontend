import { ref, type Ref } from 'vue';
import type { NavName } from '@/data/types';
import darkCss from '@/styles/dark.css?inline';

export type Theme = 'light' | 'dark';

/** 全局主题:light = 银白首页,dark = 深蓝首页。与 URL ?theme=dark 同步 */
const theme: Ref<Theme> = ref('light');

/** public 目录资源统一用绝对路径,避免相对 url() 在 /assets/ 下二次拼接 */
const darkCssText = darkCss.replace(/url\((['"]?)assets\//g, 'url($1/assets/');

let darkStyleEl: HTMLStyleElement | null = null;

/** 深蓝样式通过可移除的 <style> 注入:切回银白即卸载,彻底还原 */
function applyDarkTheme(isDark: boolean) {
  document.body.classList.toggle('dark-theme', isDark);
  if (isDark) {
    if (!darkStyleEl) {
      darkStyleEl = document.createElement('style');
      darkStyleEl.id = 'dark-theme-css';
      darkStyleEl.textContent = darkCssText;
      document.head.appendChild(darkStyleEl);
    }
  } else if (darkStyleEl) {
    darkStyleEl.remove();
    darkStyleEl = null;
  }
}

export function useTheme() {
  return theme;
}

export function setTheme(next: Theme) {
  theme.value = next;
  applyDarkTheme(next === 'dark');
}

/** 导航状态:当前高亮的顶部菜单项 */
export const activeNav = ref<NavName>('首页');
