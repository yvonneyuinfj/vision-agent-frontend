import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  // quality-agent 平台后端地址（FastAPI，默认 :8000）；RAGFlow 密钥与 chat_id 全在后端
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.QUALITY_AGENT_BASE_URL || 'http://localhost:8000';

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        // 浏览器请求 /api/* → 转发到 quality-agent（同源，会话 Cookie 自动携带）
        // 不再注入 Authorization：鉴权由平台侧 /api/v1/auth 会话管理，RAGFlow 密钥不下发前端
        '/api': {
          target,
          changeOrigin: true,
        },
      },
    },
  };
});
