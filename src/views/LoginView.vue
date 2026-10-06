<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import IconSvg from '@/components/IconSvg.vue';
import { setTheme, useTheme, type Theme } from '@/composables/use-theme';
import { login } from '@/composables/use-auth';

const route = useRoute();
const router = useRouter();
const theme = useTheme();
const dark = computed(() => theme.value === 'dark');

// 进入登录页时按 URL 同步主题(与其余视图一致的深蓝/银白切换)
setTheme(route.query.theme === 'dark' ? 'dark' : 'light');

const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

function toggleTheme() {
  const next: Theme = dark.value ? 'light' : 'dark';
  setTheme(next);
  router.replace({ path: '/login', query: { ...route.query, theme: next === 'dark' ? 'dark' : undefined } });
}

async function submit() {
  if (loading.value) return;
  if (!username.value.trim() || !password.value) {
    error.value = '请输入账号和密码';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await login(username.value.trim(), password.value);
    // 仅接受站内路径,避免开放重定向
    const raw = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    const target = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
    router.replace(target);
  } catch (e: any) {
    error.value = e?.message || '登录失败,请稍后重试';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page" :class="{ 'login-dark': dark }">
    <button class="login-theme" type="button" :aria-label="dark ? '切换银白主题' : '切换深蓝主题'" @click="toggleTheme">
      <IconSvg name="sun" /><span>{{ dark ? '银白模式' : '深蓝模式' }}</span>
    </button>

    <div class="login-card">
      <aside class="login-brand">
        <img class="login-logo" src="/assets/logo.png" alt="工业图像智能检测智能体 Logo" />
        <h2>工业图像智能检测智能体</h2>
        <p>INDUSTRIAL VISION INTELLIGENCE</p>
        <span class="login-brand-note">统一身份认证 · 会话由服务端安全签发</span>
      </aside>

      <main class="login-form">
        <h1>登录</h1>
        <p class="login-sub">请使用平台账号登录以访问知识中心等功能。</p>

        <form @submit.prevent="submit">
          <label class="login-field">
            <span>账号</span>
            <input
              v-model="username"
              type="text"
              name="username"
              autocomplete="username"
              placeholder="请输入账号"
              :disabled="loading"
            />
          </label>
          <label class="login-field">
            <span>密码</span>
            <input
              v-model="password"
              type="password"
              name="password"
              autocomplete="current-password"
              placeholder="请输入密码"
              :disabled="loading"
            />
          </label>

          <p v-if="error" class="login-error" role="alert">{{ error }}</p>

          <button class="login-submit" type="submit" :disabled="loading">
            {{ loading ? '登录中…' : '登录' }}
          </button>
        </form>
      </main>
    </div>
  </div>
</template>
