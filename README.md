<div align="center">

# TriliumNext 增强版(集成自媒体+Lsky Pro 图床）

**基于 TriliumNext v0.103.0 的自定义版本**
增强 AI/LLM 集成 + 自媒体发布引擎 + Lsky Pro 图床

[![GitHub Stars](https://img.shields.io/github/stars/personal82555/triliumnext-custom)](https://github.com/personal82555/triliumnext-custom)
[![License](https://img.shields.io/github/license/personal82555/triliumnext-custom)](LICENSE)

</div>

---

## ✨ 自定义功能

本仓库基于 [TriliumNext](https://github.com/TriliumNext/Trilium) v0.103.0 进行了以下功能增强：

### 🤖 AI/LLM 集成增强

| 功能 | 说明 |
|------|------|
| **自定义 Provider** | 支持配置任意 OpenAI 兼容接口（自定义 Base URL + API Key + 模型名） |
| **多 Provider 切换** | 侧边栏聊天支持在不同 LLM Provider 之间切换 |
| **流式响应** | ChatInputBar 支持流式输出，实时显示生成内容 |
| **Provider 管理界面** | 可视化配置页面，支持新增/编辑/删除自定义 Provider |
| **兼容性** | 兼容 OpenAI、Anthropic、本地 Ollama、new-api 等 OpenAI 格式接口 |

**修改文件：**
- `apps/client/src/widgets/type_widgets/options/llm/AddProviderModal.tsx` — Provider 配置弹窗
- `apps/client/src/widgets/type_widgets/options/llm.tsx` — LLM 选项页
- `apps/client/src/widgets/type_widgets/llm_chat/ChatInputBar.tsx` — 输入栏增强
- `apps/client/src/widgets/sidebar/SidebarChat.tsx` — 侧边栏聊天重构
- `apps/server/src/routes/api/llm_chat.ts` — 服务端多 Provider 路由
- `apps/server/src/services/llm/index.ts` — LLM 服务核心
- `apps/server/src/services/llm/providers/openai.ts` — OpenAI 兼容 Provider

---

### 📰 自媒体发布引擎

一键将笔记发布到多个自媒体平台：

| 平台 | 状态 | 说明 |
|------|------|------|
| **WordPress** | ✅ 已实现 | 支持 REST API 发布，自定义分类/标签 |
| **微信公众号** | ✅ 已实现 | 通过 WechatSync Bridge 发布 |
| **Article 笔记类型** | ✅ 已实现 | 专用文章编辑器，带浮动发布按钮 |

**核心模块：**
```
apps/server/src/services/publisher/
├── types.ts          # 发布类型定义
├── core.ts           # 发布引擎核心
├── wordpress.ts      # WordPress 适配器
└── wechat.ts         # 微信公众号适配器
```

**ETAPI 端点：**
- `POST /etapi/publishing/publish` — 发布文章到指定平台
- `GET /etapi/publishing/platforms` — 获取已配置的平台列表
- `POST /etapi/publishing/test` — 测试平台连接

---

### 🖼️ Lsky Pro 图床集成

笔记中的图片自动上传到自建 Lsky Pro 图床：

| 功能 | 说明 |
|------|------|
| **自动上传** | 粘贴/拖拽图片时自动上传到 Lsky Pro |
| **相册归类** | 支持 `albumId` 参数，图片自动归入指定相册 |
| **策略选择** | 支持配置上传策略（`strategy_id`） |
| **公网域名** | 支持配置自定义公网访问域名 |
| **ETAPI 管理** | 通过 ETAPI 端点管理图床配置和测试连接 |

**设置选项（前端 UI 可配置）：**
- `lskyApiUrl` — Lsky Pro API 地址
- `lskyToken` — API Token
- `lskyStrategyId` — 上传策略 ID
- `lskyAlbumId` — 目标相册 ID（新增）
- `lskyPublicDomain` — 公网访问域名
- `lskyEnabled` — 启用/禁用开关

**ETAPI 端点：**
- `GET /etapi/media/config` — 获取图床配置状态
- `POST /etapi/media/save-config` — 保存图床配置
- `POST /etapi/media/test` — 测试图床连接
- `POST /etapi/media/upload` — 上传图片
- `POST /etapi/media/upload-url` — 通过 URL 上传图片

---

### 📝 Article 笔记类型

新增专用文章编辑器，支持自媒体内容创作：

- **富文本编辑** — 基于 ProseMirror 的 WYSIWYG 编辑器
- **浮动发布按钮** — 编辑界面右下角一键发布
- **封面图设置** — 支持设置文章封面图
- **平台适配** — 自动适配各平台格式要求

---

## 🔧 技术栈

- **前端**：TypeScript + React + ProseMirror
- **后端**：TypeScript + Express + SQLite
- **构建**：pnpm + esbuild
- **图床**：Lsky Pro（兰空图床）
- **发布**：WechatSync Bridge + WordPress REST API

---

## 🚀 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/personal82555/triliumnext-custom.git
cd triliumnext-custom
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 构建

```bash
cd apps/server
pnpm server:build
```

### 4. 配置环境变量

创建 `.env.lsky` 文件：

```bash
LSKY_API_URL=http://your-lsky-host:8089
LSKY_TOKEN=your-api-token
LSKY_STRATEGY_ID=1
LSKY_ALBUM_ID=1
LSKY_PUBLIC_DOMAIN=https://img.your-domain.com
LSKY_ENABLED=true
```

### 5. 启动服务

```bash
TRILIUM_ENV=production \
TRILIUM_DATA_DIR=/path/to/data \
TRILIUM_PORT=8083 \
node dist/main.cjs
```

---

## 📁 项目结构

```
triliumnext-custom/
├── apps/
│   ├── client/src/
│   │   ├── widgets/
│   │   │   ├── type_widgets/
│   │   │   │   ├── article/           # Article 笔记类型
│   │   │   │   ├── llm_chat/          # LLM 聊天组件
│   │   │   │   └── options/llm/       # LLM 配置界面
│   │   │   └── sidebar/
│   │   │       └── SidebarChat.tsx    # 侧边栏聊天
│   │   └── services/
│   │       └── note_types.ts          # 笔记类型注册
│   └── server/src/
│       ├── etapi/
│       │   ├── media.ts               # 图床 ETAPI 端点
│       │   └── publishing.ts          # 发布 ETAPI 端点
│       ├── routes/
│       │   ├── api/
│       │   │   ├── llm_chat.ts        # LLM 聊天路由
│       │   │   └── publisher_frontend.ts
│       │   └── routes.ts              # 路由注册
│       └── services/
│           ├── llm/                   # LLM 服务
│           ├── media_host/lskypro.ts  # Lsky Pro 图床
│           └── publisher/             # 发布引擎
└── README.md
```

---

## 🔄 上游同步

```bash
# 添加上游仓库
git remote add upstream https://github.com/TriliumNext/Trilium.git

# 拉取上游更新
git fetch upstream

# 合并到本地
git merge upstream/main

# 推送到自己的 fork
git push fork main
```

---

## 📄 License

本项目基于 TriliumNext，遵循 [AGPL-3.0 License](LICENSE)。

---

<div align="center">

**基于 [TriliumNext](https://github.com/TriliumNext/Trilium) 构建**

</div>
