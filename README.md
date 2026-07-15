# DramaForge AI

DramaForge AI 是一个面向短剧创作的 React + FastAPI 工作台。它把用户目标、Agent 推理、资产生成和画布编辑放在同一条工作流中：Agent 的思考与状态显示在 ThoughtStream，画布只展示可编辑的资产节点。

![React](https://img.shields.io/badge/React-19-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)
![Vite](https://img.shields.io/badge/Vite-6-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)

## 当前能力

- Agent 模式：输入创作目标，Agent 通过 ReAct 工具链解析目标、规划步骤并生成资产。
- ThoughtStream：集中展示思考、动作、观察、工具错误和用户交互，不在画布中创建过程节点。
- 资产画布：复用普通画布节点展示脚本、角色、场景、道具、图片、音频和视频等资产。
- 人机协作：Agent 可以暂停并向用户提问；选项支持单选、多选和自由输入。
- 任务控制：支持查看任务、暂停等待、继续、主动停止和失败重试。
- 资产持久化：`save_asset` 写入后端数据库，并通过 `artifact_created` 事件同步到前端。
- Provider 管理：LLM 和媒体 provider 统一从后端配置读取；未配置时会明确报错，不使用固定测试动作或假数据。
- 普通画布流程：支持起始、上传、提示词、循环和视频生成等节点，并可继续手动编辑和运行。

## 界面预览

以下截图对应当前版本的 Agent 画布和资产节点布局。Agent 过程位于右侧 ThoughtStream，画布区域只保留资产节点。

<div align="center">

<img src="docs/屏幕截图%202026-07-14%20105107.png" alt="Agent 资产画布" width="780" />

<img src="docs/屏幕截图%202026-07-14%20105546.png" alt="普通画布节点面板" width="560" />

</div>

## 技术栈

### 前端

- React 19
- TypeScript 5.8
- Vite 6
- Zustand
- Lucide React
- Vitest + Testing Library

### 后端

- Python 3.12+
- FastAPI
- SQLAlchemy
- SQLite（开发环境默认）
- OpenAI-compatible LLM client
- SSE / replay buffer 用于 Agent 事件流

## 本地运行

### 1. 安装前端依赖

```bash
npm install
```

### 2. 安装后端依赖

```bash
cd backend
uv sync
```

如果没有安装 `uv`，也可以使用 Python 3.12 虚拟环境安装项目依赖。

### 3. 启动后端

在 `backend` 目录执行：

```bash
uv run uvicorn app:app --reload --port 8000
```

后端 API 默认位于 `http://localhost:8000`，健康检查地址为 `http://localhost:8000/api/health`。

### 4. 启动前端

在项目根目录执行：

```bash
npm run dev
```

打开 <http://localhost:5173>。Vite 会把 `/api` 请求代理到本地后端。

## 使用 Agent 模式

1. 先在 Provider 设置中配置一个可用的 LLM provider；需要生成图片、视频或音频时，同时配置对应的媒体 provider。
2. 在 Agent 输入框输入目标，例如“制作一个关于郑成功的三分钟历史短剧”。
3. Agent 会在 ThoughtStream 中展示当前步骤，并在需要补充信息时暂停提问。
4. 用户可以点击选项、进行多选，或直接输入自己的描述后提交。
5. 生成的资产会持久化并出现在画布中；Agent 的思考和状态不会被绘制成画布节点。
6. 任务运行期间可以主动停止。停止后后台任务和过期的 LLM 动作都会被取消，不会继续执行旧动作。

## 常用命令

```bash
# 前端开发
npm run dev

# 前端测试
npm test

# 前端生产构建
npm run build

# 后端测试
cd backend
uv run pytest
```

## 项目结构

```text
dramaforge-ai/
├── agent/                      # Agent UI、ThoughtStream、任务控制
├── components/infinite-canvas/ # 普通资产画布和节点运行逻辑
├── services/                   # 前端 API client 和媒体服务
├── backend/app/agent/          # Agent runtime、LLM、工具和事件
├── backend/app/routers/        # FastAPI 路由
├── backend/app/models.py       # 数据库模型
├── backend/tests/              # 后端回归测试
├── tests/                      # 前端组件和画布测试
└── docs/                       # 当前设计文档和界面截图
```

## 事件与数据流

```text
用户目标
  → startAgent
  → AgentRuntime / LLM
  → ThoughtStream（思考、动作、观察、提问）
  → save_asset + artifact_created
  → Agent store
  → 普通资产节点
```

Agent 任务、步骤和资产都由后端持久化。用户回复会作为下一轮 LLM 的 observation 重新注入上下文；停止、继续和重试也都通过后端任务状态驱动。

## 许可证

项目当前处于持续开发阶段。使用第三方模型或媒体 provider 时，请遵守对应服务商的条款和使用限制。
