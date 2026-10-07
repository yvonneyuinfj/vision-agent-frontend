# Vision Agent UI · 工业图像智能检测智能体前端

工业视觉质检智能体的 Web 前端，覆盖能力中心、智能检测、任务中心、知识中心、工具服务与后台管理六大模块。支持两种运行模式：

- **真实后端模式**：经 Vite 代理（或 Nginx 反代）同源调用 quality-agent 平台 API（FastAPI）
- **本地演示模式**：不接后端，使用内置演示数据，任一步失败自动回退

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 框架 | Vue 3（Composition API）+ TypeScript |
| 构建 | Vite 4 |
| UI 组件 | Ant Design Vue 4 |
| 路由 | Vue Router 4（History 模式） |
| 包管理 | npm（Node ≥ 16.14） |

## 功能模块

| 路由 | 模块 | 说明 |
| --- | --- | --- |
| `/` | 首页 | 产品全景与图片上传入口 |
| `/capabilities` | 能力中心 | 六大检测能力（孔探 / DR / FPI / 断口 / 红外 / 金相）与通用能力 |
| `/detection` | 智能检测 | 智能视觉助手对话式检测，卡片流式推送 |
| `/tasks` | 任务中心 | 任务创建、样本、审核、报告 |
| `/report/:taskId` | 质检报告 | 单任务智能质检报告 |
| `/knowledge` | 知识中心 | 知识采集、入库、检索 |
| `/tools` | 工具服务 | 工具能力注册与调用 |
| `/admin/*` | 后台管理 | 接口监控、基模 / RAGFlow / 存储端点配置 |
| `/login` | 登录 | 平台会话登录（仅真实后端模式启用） |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 复制环境变量示例（按需修改）
#    Windows PowerShell:
Copy-Item .env.example .env.local
#    Linux / macOS:
cp .env.example .env.local

# 3. 启动开发服务器（默认 http://localhost:5173）
npm run dev

# 4. 生产构建 / 本地预览构建产物
npm run build
npm run preview
```

## 环境变量

所有配置集中在 `.env.local`（不入库，示例见 `.env.example`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_QA_ENABLED` | `true` | 是否启用真实后端；`false` 为纯演示模式 |
| `VITE_QA_API_BASE` | `/api/v1` | 前端调用的平台 API 前缀 |
| `QUALITY_AGENT_BASE_URL` | `http://localhost:8000` | quality-agent 后端地址，仅 Vite 代理使用，**不会打包进前端** |

> 安全说明：RAGFlow 的 `base_url` / `api_key` / `chat_id` / `dataset_id` 全部由 quality-agent 后端统一管理，前端不接触任何密钥。鉴权走平台 `/api/v1/auth` 会话 Cookie；本地调试可在 quality-agent 侧设置 `AUTH_ENABLED=false` 免登录直连。

## 目录结构

```
frontend/
├── public/assets/        # 静态资源（能力图、logo 等）
├── src/
│   ├── api/              # 后端接口封装（agent / auth / tasks / ragflow 等）
│   ├── components/       # 通用组件（头部、弹窗、卡片、Markdown 渲染等）
│   ├── composables/      # 组合式逻辑（会话、检测流、任务、主题、文件选择等）
│   ├── data/             # 演示数据与能力注册表
│   ├── router/           # 路由与登录守卫
│   ├── styles/           # 全局与各模块样式
│   ├── utils/            # 导出、Markdown 工具
│   └── views/            # 页面视图（首页 / 检测 / 任务 / 知识 / 工具 / 后台）
├── .env.example          # 环境变量示例
├── vite.config.ts        # Vite 配置（含 /api 代理）
└── package.json
```

## 与后端联调

开发时浏览器请求 `/api/*` 由 Vite 代理转发至 `QUALITY_AGENT_BASE_URL`（默认本地 `:8000`），保持同源以便会话 Cookie 自动携带。生产部署建议用 Nginx 将前端静态资源与 `/api/v1` 反代到同一域名下。

## 版本

当前版本 `v1.0.0`，详见 git tag。设计规约参见 [DESIGN-STANDARD.md](./DESIGN-STANDARD.md)。
