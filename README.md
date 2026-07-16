# DramaForge AI

DramaForge AI 是一个面向短剧创作的 React + FastAPI 工作台。Agent 运行在现有画布中：画布只展示可复用的资产节点，思考、计划、提问、并行生成和失败恢复统一显示在 ThoughtStream 与可拖动桌宠面板中。

## 核心工作流

```text
上传资产 → 持久化到当前项目 → 多模态检查 → 必要时标准化 → 生成时按资产 ID 引用 → 跨镜头复用
```

- 上传的角色、道具、场景会立即成为当前项目的资产节点，刷新或切换项目不会串数据。
- Agent 会先检查上传资产。单人物照片如果不符合项目角色标准，会创建带 `source_asset_id` 的角色标准化衍生资产。
- 图片和视频工具接收 `reference_asset_ids`，服务端解析项目内 URL，优先使用可用的标准化衍生资产。
- 多个互相独立的图片/视频任务通过批量工具并行执行；每个任务先创建 pending 资产节点，失败项独立显示并进入有界恢复流程。
- 用户提问始终支持自由文本，选项只是快捷建议。
- 主动停止会取消后续 provider/recovery 工作，忽略取消后的迟到响应。

## 能力配置

API 设置只绑定三类能力：`llm`、`image`、`video`。Agent 与普通画布共用这套配置，不再使用隐藏的旧步骤模型或测试模型回退。

上传资产的自动识别需要绑定支持图片输入的 LLM。图片/视频生成分别需要对应的能力绑定；如果缺少绑定，系统会在 ThoughtStream 中明确提示，不会静默使用旧配置。provider 是否支持参考图也会影响可用的引用路径。

## 本地运行

前端：

```bash
npm install
npm run dev
```

后端：

```bash
cd backend
uv sync
uv run uvicorn app:app --reload --port 8765
```

健康检查：<http://127.0.0.1:8765/api/health>

## 测试与构建

```bash
# 前端单元/组件测试
npm test

# 前端生产构建
npm run build

# 后端完整测试
cd backend
uv run pytest -q
```

重点资产工作流测试覆盖上传持久化、项目隔离、多模态检查、角色标准化、参考资产解析、重复生成保护和 Agent 事件反馈，见 `backend/tests/test_asset_intelligence_contract.py`。

## 目录

```text
agent/                       Agent 状态、ThoughtStream、桌宠交互
components/infinite-canvas/  资产画布、节点和 API 设置
services/                    前端 API client 与媒体服务
backend/app/agent/           Agent runtime、LLM、资产智能和工具
backend/app/routers/         FastAPI 路由
backend/app/models.py        项目、任务、节点、资产和 provider 模型
backend/tests/               后端回归测试
tests/                       前端组件与交互测试
docs/                        设计、工作流和运维文档
```
