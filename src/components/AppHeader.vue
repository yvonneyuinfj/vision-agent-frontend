<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import IconSvg from './IconSvg.vue';
import type { NavName } from '@/data/types';
import { openModule, showUserCenter } from '@/composables/use-navigation';
import { useTheme, setTheme, activeNav, type Theme } from '@/composables/use-theme';
import { ragflowEnabled } from '@/api/ragflow';
import { auth, logout } from '@/composables/use-auth';

const router = useRouter();
const route = useRoute();
const theme = useTheme();

const loggedIn = computed(() => ragflowEnabled && auth.logged_in);

const navItems: NavName[] = [
  '首页', '智能检测', '能力中心', '任务中心', '知识中心', '模型工坊', '工具服务中心', '后台管理',
];

const isCenter = computed(() => route.path === '/capabilities');
const active = computed<NavName>(() => (isCenter.value ? '能力中心' : activeNav.value));

const dropdown = reactive({ open: false, left: 0, top: 0, name: '' as NavName | '' });
const userMenu = reactive({ open: false, left: 0, top: 0 });

function toggleUserMenu(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  userMenu.left = Math.max(12, Math.min(rect.right - 216, window.innerWidth - 228));
  userMenu.top = rect.bottom + 8;
  userMenu.open = !userMenu.open;
}

function onUserClick(event: MouseEvent) {
  if (loggedIn.value) {
    dropdown.open = false;
    toggleUserMenu(event.currentTarget as HTMLElement);
  } else {
    showUserCenter();
  }
}

async function doLogout() {
  userMenu.open = false;
  await logout();
  router.push({ path: '/login' });
}

/** 主题切换:翻转全局主题并同步当前 URL 的 ?theme 参数 */
function toggleTheme() {
  const next: Theme = theme.value === 'dark' ? 'light' : 'dark';
  setTheme(next);
  const query = { ...route.query };
  if (next === 'dark') query.theme = 'dark'; else delete query.theme;
  router.replace({ path: route.path, query });
}

const themeQuery = computed<Record<string, string>>(() => (theme.value === 'dark' ? { theme: 'dark' } : {} as Record<string, string>));

/** 二级菜单数据（可扩展）：有 children 的导航项悬浮即展开 */
interface SubLink { title: string; desc: string; to: { path: string; query: Record<string, string>; hash: string } }
const navChildren = computed<Partial<Record<NavName, SubLink[]>>>(() => ({
  能力中心: [
    { title: '专业能力', desc: '六项专业检测能力', to: { path: '/capabilities', query: themeQuery.value, hash: '#professional' } },
    { title: '通用能力', desc: 'OCR 识别 · PPT 制作', to: { path: '/capabilities', query: themeQuery.value, hash: '#general' } },
  ],
}));

let openTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function positionPanel(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  dropdown.left = Math.max(12, Math.min(rect.left, window.innerWidth - 256));
  dropdown.top = rect.bottom + 8;
}

/** 悬浮（带 80ms 意图延迟）展开该项二级菜单；无二级菜单的项不响应 */
function onNavEnter(name: NavName, e: Event) {
  if (!navChildren.value[name]?.length) return;
  const el = e.currentTarget as HTMLElement;
  clearTimeout(openTimer); clearTimeout(closeTimer);
  openTimer = setTimeout(() => {
    positionPanel(el);
    dropdown.name = name;
    dropdown.open = true;
  }, 80);
}

/** 离开时延迟收起，留出跨越按钮与面板缝隙的时间 */
function onNavLeave() {
  clearTimeout(openTimer); clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { dropdown.open = false; dropdown.name = ''; }, 180);
}
function onPanelEnter() { clearTimeout(closeTimer); }
function onPanelLeave() { onNavLeave(); }

function navTo(name: NavName) {
  clearTimeout(openTimer); clearTimeout(closeTimer);
  dropdown.open = false; dropdown.name = '';
  openModule(name, router);
}

function goHome() {
  if (isCenter.value) router.push(theme.value === 'dark' ? '/?theme=dark' : '/');
  else openModule('首页', router);
}

watch(() => route.fullPath, () => { dropdown.open = false; dropdown.name = ''; userMenu.open = false; });
</script>

<template>
  <header class="site-header">
    <a class="brand" href="#" aria-label="返回首页" @click.prevent="goHome">
      <img class="brand-logo" src="/assets/logo.png" alt="工业图像智能检测智能体 Logo" />
      <span>
        <strong>工业图像智能检测智能体</strong>
        <small>INDUSTRIAL VISION INTELLIGENCE</small>
      </span>
    </a>
    <nav class="main-nav" aria-label="主导航">
      <button
        v-for="name in navItems"
        :key="name"
        :class="{ active: active === name }"
        :aria-current="active === name ? 'page' : undefined"
        @mouseenter="onNavEnter(name, $event)"
        @mouseleave="onNavLeave"
        @focus="onNavEnter(name, $event)"
        @blur="onNavLeave"
        @click="navTo(name)"
      >{{ name }}</button>
    </nav>
    <div class="header-actions">
      <button class="theme-toggle" type="button" :aria-label="theme === 'dark' ? '切换银白主题' : '切换深蓝主题'" :title="theme === 'dark' ? '切换银白主题' : '切换深蓝主题'" @click="toggleTheme">
        <IconSvg :name="theme === 'dark' ? 'sun' : 'moon'" />
      </button>
      <button class="user-button" type="button" @click="onUserClick">
        <IconSvg name="user" /><span>{{ loggedIn ? auth.username || '已登录' : '用户中心' }}</span><span class="chevron"></span>
      </button>
    </div>
  </header>

  <Teleport to="body">
    <div
      v-show="dropdown.open"
      id="cap-dropdown"
      class="cap-dropdown"
      :class="{ 'dark-menu': theme === 'dark' }"
      :aria-label="(dropdown.name || '') + '二级导航'"
      :style="{ top: dropdown.top + 'px', left: dropdown.left + 'px' }"
      @mouseenter="onPanelEnter"
      @mouseleave="onPanelLeave"
    >
      <RouterLink
        v-for="link in (dropdown.name ? navChildren[dropdown.name] || [] : [])"
        :key="link.title"
        :to="link.to"
        @click="dropdown.open = false; dropdown.name = ''"
      >
        <strong>{{ link.title }}</strong><span>{{ link.desc }}</span>
      </RouterLink>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-show="userMenu.open"
      class="cap-dropdown user-dropdown"
      :class="{ 'dark-menu': theme === 'dark' }"
      aria-label="用户菜单"
      :style="{ top: userMenu.top + 'px', left: userMenu.left + 'px' }"
      @click="userMenu.open = false"
    >
      <div class="user-menu-name">当前登录：{{ auth.username || '—' }}</div>
      <button type="button" class="user-menu-logout" @click.stop="doLogout">退出登录</button>
    </div>
  </Teleport>
</template>
