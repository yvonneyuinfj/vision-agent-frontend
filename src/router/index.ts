import { createRouter, createWebHistory } from 'vue-router';
import { ragflowEnabled } from '@/api/ragflow';
import { auth, ensureSession } from '@/composables/use-auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
    { path: '/capabilities', name: 'capabilities', component: () => import('@/views/CapabilitiesView.vue') },
    { path: '/detection', name: 'detection', component: () => import('@/views/DetectionView.vue') },
    { path: '/tasks', name: 'tasks', component: () => import('@/views/task/TaskCenterView.vue') },
    // 复核工作台：独立路由页（任务列表「去复核」与检测卡片的深链入口）
    { path: '/tasks/review', name: 'tasks-review', component: () => import('@/views/task/TaskReviewWorkbench.vue') },
    { path: '/report/:taskId', name: 'report', component: () => import('@/views/ReportView.vue') },
    { path: '/knowledge', name: 'knowledge', component: () => import('@/views/knowledge/KnowledgeView.vue') },
    { path: '/tools', name: 'tools', component: () => import('@/views/tools/ToolsView.vue') },
    { path: '/admin', name: 'admin', component: () => import('@/views/admin/ApiMonitorView.vue') },
    { path: '/admin/llm', name: 'admin-llm', component: () => import('@/views/admin/ConfigResourceView.vue'), meta: { kind: 'llm' } },
    { path: '/admin/ragflow', name: 'admin-ragflow', component: () => import('@/views/admin/ConfigResourceView.vue'), meta: { kind: 'ragflow' } },
    { path: '/admin/storage', name: 'admin-storage', component: () => import('@/views/admin/ConfigResourceView.vue'), meta: { kind: 'storage' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

// 全局守卫:仅远程模式强制登录;演示模式(ragflowEnabled=false)直接放行
router.beforeEach(async (to) => {
  if (!ragflowEnabled) return true;
  await ensureSession();
  if (to.meta.public) {
    // 已登录访问登录页则回首页
    return auth.logged_in && to.name === 'login' ? { path: '/' } : true;
  }
  if (!auth.logged_in) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  return true;
});

router.afterEach((to) => {
  const dark = to.query.theme === 'dark';
  if (to.path === '/login') {
    document.title = '登录 · 工业图像智能检测智能体';
  } else if (to.path === '/capabilities') {
    document.title = (to.hash === '#general' ? '通用能力' : '专业能力') + ' · 能力中心';
  } else if (to.path === '/detection') {
    document.title = '智能检测 · 智能视觉助手';
  } else if (to.path === '/tasks') {
    document.title = '任务中心';
  } else if (to.path === '/tasks/review') {
    document.title = '复核工作台 · 任务中心';
  } else if (to.path.startsWith('/report')) {
    document.title = '智能质检报告';
  } else if (to.path === '/knowledge') {
    document.title = '知识中心';
  } else if (to.path === '/tools') {
    document.title = '工具服务中心';
  } else if (to.path === '/admin') {
    document.title = '后台管理 · 接口监控';
  } else if (to.path === '/admin/llm') {
    document.title = '后台管理 · 基模配置';
  } else if (to.path === '/admin/ragflow') {
    document.title = '后台管理 · RAGFlow 连接';
  } else if (to.path === '/admin/storage') {
    document.title = '后台管理 · 存储端点';
  } else {
    document.title = dark ? '工业图像智能检测智能体 · 深蓝全景' : '工业图像智能检测智能体 · 全生命周期';
  }
});

export default router;
