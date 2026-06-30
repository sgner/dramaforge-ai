# DramaForge AI — Agent 化重构实施计划

> **版本**：v1.0
> **日期**：2026-06-30
> **依赖**：[PRD.md](./PRD.md)

---

## 0. 总体策略

将 DramaForge AI 从"7 步硬编码 switch"重构为"ReAct Agent 框架"。采用**渐进式迁移**而非"推倒重写"：

- **第 1-2 周**：抽出 Agent 框架（后端 + 前端状态机），保留旧 7 步作为工具
- **第 3-4 周**：新增 Thought Stream + 任务图画布
- **第 5-6 周**：实现 Plan 阶段 + 用户审核流程
- **第 7-8 周**：内测 + 优化

每周末产出可演示版本，旧工作流仍可用，逐步引导迁移。

---

## 1. 架构总览

### 1.1 改造前后对比

```
【改造前】                              【改造后】
┌─────────────────┐                    ┌──────────────────────────┐
│  useTaskExecutor│                    │  AgentRuntime            │
│  switch (status)│                    │  ┌─────────────────────┐ │
│  ┌──────────┐  │                    │  │ ReAct Loop          │ │
│  │ PRE      │  │                    │  │ Thought→Action→     │ │
│  │ SCRIPT   │  │                    │  │ Observation         │ │
│  │ CHAR     │  │    ──────→         │  └─────────────────────┘ │
│  │ PROP     │  │                    │  ┌─────────────────────┐ │
│  │ SCENE    │  │                    │  │ ToolRegistry (18)   │ │
│  │ SHOT     │  │                    │  └─────────────────────┘ │
│  │ PROMPT   │  │                    │  ┌─────────────────────┐ │
│  └──────────┘  │                    │  │ Memory + Plan       │ │
│  顺序硬编码     │                    │  └─────────────────────┘ │
└─────────────────┘                    └──────────────────────────┘
                                       ↓ 事件流
                                       ┌──────────────────────────┐
                                       │  TaskGraph (画布)        │
                                       │  ThoughtStream (侧栏)   │
                                       └──────────────────────────┘
```

### 1.2 关键技术决策

| 决策 | 选择 | 理由 |
|---|---|---|
| Agent loop 实现位置 | **后端 (FastAPI)** | LLM 决策需要持久化、跨断点续传、支持多用户 |
| 前端通信 | **SSE (Server-Sent Events)** | 实时 thought 流式推送，比 WebSocket 简单 |
| 任务图存储 | **JSON 文档 (Node.data 字段)** | 已有 data JSON 字段，零迁移成本 |
| Plan 阶段 | **强制 + 用户审核** | 防止 LLM 乱决策 |
| 工具 sandbox | **Python 同步函数 + try/except** | 简单可靠，复杂沙箱 v1.1 再上 |
| 旧代码兼容 | **保留 7 步作为"v0 模式"** | 老用户无感迁移 |

### 1.3 目录结构变化

```
backend/
├── app/
│   ├── agent/                    # ★ 新增
│   │   ├── __init__.py
│   │   ├── runtime.py            # ReAct 主循环
│   │   ├── llm.py                # LLM 调用封装
│   │   ├── tools/                # 工具实现
│   │   │   ├── __init__.py
│   │   │   ├── base.py           # Tool 基类
│   │   │   ├── planning.py       # parse_user_goal / create_plan / ask_user
│   │   │   ├── llm_tools.py      # generate_script / extract_* / optimize_prompt
│   │   │   ├── image_tools.py    # generate_*_image
│   │   │   ├── video_tools.py    # generate_video
│   │   │   ├── audio_tools.py    # generate_voiceover / generate_bgm
│   │   │   └── asset_tools.py    # save_asset / upload_reference
│   │   ├── memory.py             # 任务上下文 + 长期记忆
│   │   ├── events.py             # 事件类型定义
│   │   └── stream.py             # SSE 推送
│   ├── routers/
│   │   ├── agent.py              # ★ 新增: /api/agent/...
│   │   ├── projects.py           # 兼容
│   │   ├── assets.py             # 兼容
│   │   └── uploads.py            # 兼容
│   ├── models.py                 # +AgentTask, AgentStep
│   ├── schemas.py                # +AgentTask*, AgentEvent
│   ├── legacy_executor.py        # ★ 旧 useTaskExecutor 等价 Python 版
│   └── database.py
└── main.py

frontend/
├── components/
│   ├── infinite-canvas/          # 保留作为画布组件
│   │   ├── ...
│   │   ├── TaskGraphNode.tsx     # ★ 新增: 任务图节点（Goal/Plan/Action/Artifact...）
│   │   ├── TaskGraphEdge.tsx     # ★ 新增: 任务图连线
│   │   ├── ThoughtStream.tsx     # ★ 新增: 左侧 thought 流
│   │   ├── ToolPalette.tsx       # ★ 新增: 工具面板
│   │   ├── PendingApprovalCard.tsx  # ★ 新增: 用户审核卡片
│   │   ├── task-graph.css        # ★ 新增: 任务图样式
│   │   └── use-agent-store.ts    # ★ 新增: agent 状态管理
│   ├── AgentMode.tsx             # ★ 新增: agent 模式入口
│   ├── LegacyMode.tsx            # ★ 新增: 旧工作流模式（兼容）
│   └── ...
├── hooks/
│   ├── useTaskExecutor.ts        # 保留，标记 deprecated
│   ├── useAgentStream.ts         # ★ 新增: SSE 客户端
│   └── useTaskActions.ts
├── services/
│   ├── apiAdapter.ts             # 保留兼容
│   ├── apiClient.ts              # + agent API 方法
│   ├── llmClient.ts              # 移到后端，前端不再直连
│   └── ...
├── types.ts                      # + AgentTask, AgentStep, AgentEvent
└── ...
```

---

## 2. 后端实施（Week 1-4）

### Phase 1: Agent 框架骨架 (Week 1)

#### 1.1 任务：搭建 Agent Runtime

**文件**：`backend/app/agent/runtime.py`

```python
class AgentRuntime:
    """ReAct 主循环"""

    def __init__(self, task_id: str, db: Session):
        self.task_id = task_id
        self.db = db
        self.tools = ToolRegistry()
        self.memory = AgentMemory(task_id, db)
        self.events = EventEmitter(task_id)

    async def run(self, user_input: str):
        """主入口"""
        # 1. 解析用户目标
        goal = await self.call_tool("parse_user_goal", {"user_input": user_input})
        self.memory.set_goal(goal)

        # 2. 创建 Plan（需要用户审核）
        plan = await self.call_tool("create_plan", {"goal": goal})
        self.memory.set_plan(plan)
        await self.events.emit("plan_ready", plan)

        # 3. 等待用户审核 plan
        approved = await self.wait_for_user_approval("plan")
        if not approved:
            plan = await self.revise_plan(user_feedback=approved.feedback)
            await self.wait_for_user_approval("plan")

        # 4. ReAct 循环
        max_steps = 30
        for step_num in range(max_steps):
            thought = await self.think()  # LLM 思考下一步
            self.events.emit("thought", thought)

            action = await self.decide_action(thought)  # LLM 决定调哪个工具
            self.events.emit("action", action)

            if action.tool == "ask_user":
                user_response = await self.wait_for_user_input(action.question)
                observation = user_response
            else:
                observation = await self.call_tool(action.tool, action.params)

            self.memory.add_step(thought, action, observation)
            self.events.emit("observation", observation)

            if self.is_done(observation):
                break

    async def think(self) -> Thought:
        """让 LLM 决定下一步"""
        prompt = self.memory.build_react_prompt()
        return await self.llm.generate(prompt, response_format=Thought)

    async def decide_action(self, thought: Thought) -> Action:
        """基于 thought 决定调用哪个工具"""
        return thought.action  # LLM 在 thought 中已选定

    async def call_tool(self, name: str, params: dict) -> dict:
        """调用工具 + 异常隔离"""
        tool = self.tools.get(name)
        if not tool:
            return {"error": f"Unknown tool: {name}"}
        try:
            result = await tool.execute(self, params)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
```

**验收**：
- [ ] 单元测试：能 mock LLM 完成 5 步 ReAct
- [ ] 集成测试：能跑通 create_plan → generate_script → save_asset 3 步

#### 1.2 任务：Tool 基类 + Registry

**文件**：`backend/app/agent/tools/base.py`

```python
from pydantic import BaseModel, Field
from typing import Callable, Any

class ToolParameter(BaseModel):
    name: str
    type: str  # "string" | "number" | "array" | "object"
    description: str
    required: bool = True
    enum: list | None = None

class Tool(BaseModel):
    name: str
    description: str
    category: str
    parameters: list[ToolParameter]
    requires_approval: bool = False
    estimated_cost_usd: float = 0.0
    estimated_time_sec: float = 0.0
    execute: Callable  # 实际执行函数

class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool):
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def list(self, category: str | None = None) -> list[Tool]:
        tools = list(self._tools.values())
        if category:
            tools = [t for t in tools if t.category == category]
        return tools

    def to_openai_schema(self) -> list[dict]:
        """转成 LLM function calling schema"""
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": {
                        "type": "object",
                        "properties": {p.name: {"type": p.type, "description": p.description} for p in t.parameters},
                        "required": [p.name for p in t.parameters if p.required],
                    },
                },
            }
            for t in self._tools.values()
        ]
```

#### 1.3 任务：事件系统 + SSE 推送

**文件**：`backend/app/agent/events.py`、`backend/app/agent/stream.py`

```python
# events.py
class AgentEvent(BaseModel):
    task_id: str
    step_id: str | None
    type: str  # thought | action | observation | plan_ready | request_user_input | done | failed
    payload: dict
    timestamp: float

# stream.py
from collections import defaultdict
import asyncio

class EventBus:
    def __init__(self):
        self.subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)

    def subscribe(self, task_id: str) -> asyncio.Queue:
        q = asyncio.Queue()
        self.subscribers[task_id].append(q)
        return q

    async def publish(self, event: AgentEvent):
        for q in self.subscribers.get(event.task_id, []):
            await q.put(event)
```

**文件**：`backend/app/routers/agent.py`

```python
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

router = APIRouter()

@router.post("/{task_id}/run")
async def run_agent(task_id: str, body: RunRequest, db: Session = Depends(get_db)):
    """启动 agent（后台运行）"""
    runtime = AgentRuntime(task_id, db)
    asyncio.create_task(runtime.run(body.user_input))
    return {"ok": True}

@router.get("/{task_id}/stream")
async def stream_agent(task_id: str):
    """SSE 流"""
    async def event_generator():
        queue = event_bus.subscribe(task_id)
        try:
            while True:
                event = await queue.get()
                yield {"event": event.type, "data": event.json()}
                if event.type in ("done", "failed"):
                    break
        finally:
            event_bus.unsubscribe(task_id, queue)
    return EventSourceResponse(event_generator())

@router.post("/{task_id}/respond")
async def user_respond(task_id: str, body: UserResponse, db: Session = Depends(get_db)):
    """用户对 ask_user / plan 审核的响应"""
    task = db.query(AgentTask).get(task_id)
    task.pending_response = body.response
    db.commit()
    return {"ok": True}

@router.post("/{task_id}/pause")
@router.post("/{task_id}/resume")
@router.post("/{task_id}/stop")
```

#### 1.4 数据库 schema 扩展

**文件**：`backend/app/models.py`

```python
class AgentTask(Base):
    __tablename__ = "agent_tasks"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"))
    user_goal = Column(Text)
    status = Column(String)  # pending | running | paused | done | failed
    plan = Column(JSON)
    artifacts = Column(JSON)
    pending_response = Column(JSON, nullable=True)  # 等待用户输入
    total_cost_usd = Column(Float, default=0.0)
    total_tokens = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

class AgentStep(Base):
    __tablename__ = "agent_steps"
    id = Column(String, primary_key=True)
    task_id = Column(String, ForeignKey("agent_tasks.id"))
    step_number = Column(Integer)
    thought = Column(Text)
    action = Column(JSON)  # {tool: string, params: dict}
    observation = Column(JSON)  # {success, result/error}
    status = Column(String)  # pending | running | success | failed | retrying
    cost_usd = Column(Float, default=0.0)
    tokens = Column(Integer, default=0)
    started_at = Column(DateTime)
    finished_at = Column(DateTime)
```

### Phase 2: 工具实现 (Week 2)

#### 2.1 任务：迁移 7 个旧步骤为 LLM 工具

**文件**：`backend/app/agent/tools/llm_tools.py`

| 工具 | 实现 | 来源 |
|---|---|---|
| `generate_script` | 包装 `services/llmClient.ts` 等价 Python 实现 | 旧 `SCRIPT_GENERATION` |
| `extract_characters` | 同上，prompt 提取 Character[] | 旧 `CHARACTER_DESIGN` 准备 |
| `extract_props` | 同上 | 旧 `PROP_DESIGN` 准备 |
| `extract_scenes` | 同上 | 旧 `SCENE_DESIGN` 准备 |
| `extract_shots` | 同上 | 旧 `STORYBOARDING` 准备 |
| `optimize_prompt` | 同上 | 旧 `PROMPT_OPTIMIZATION` |

**关键**：保留所有现有 constants.ts 中的 prompt 内容，**不动 LLM 行为**。

#### 2.2 任务：迁移图像/视频/音频生成工具

**文件**：`backend/app/agent/tools/image_tools.py`

```python
class GenerateCharacterPortraitTool(Tool):
    name = "generate_character_portrait"
    description = "Generate a four-view character portrait image"
    category = "image"
    requires_approval = True
    estimated_cost_usd = 0.05
    estimated_time_sec = 25.0

    async def execute(self, runtime, params: dict):
        character = params["character"]
        provider = runtime.get_provider("characterDesign")
        model = runtime.get_model("characterDesign")
        prompt = build_character_prompt(character)
        url = await generate_image(prompt, provider, model, runtime.context.global_refs)
        runtime.add_artifact("character", character["name"], url)
        return {"url": url, "character": character["name"]}
```

类似实现：
- `generate_prop_image`
- `generate_scene_image`
- `generate_storyboard_image`
- `generate_video` (来自 `runVideoGeneration`)
- `generate_voiceover`
- `generate_bgm`

#### 2.3 任务：实现 planning 工具

**文件**：`backend/app/agent/tools/planning.py`

```python
class ParseUserGoalTool(Tool):
    """解析用户原话，提取结构化目标"""
    name = "parse_user_goal"
    ...

class CreatePlanTool(Tool):
    """基于目标创建计划（5-10 步）"""
    name = "create_plan"
    requires_approval = True  # 必须让用户看 plan
    ...

class AskUserTool(Tool):
    """agent 主动反问用户"""
    name = "ask_user"
    requires_approval = False  # 调这个工具就是请求
    ...
```

### Phase 3: 端到端跑通 (Week 3)

#### 3.1 任务：旧工作流 → Agent 工具的"legacy mode"

**文件**：`backend/app/legacy_executor.py`

```python
async def run_legacy_pipeline(task_id: str):
    """执行旧 7 步流程，agent 不参与"""
    steps = [
        ("PREPROCESSING", preprocess),
        ("SCRIPT_GENERATION", generate_script_step),
        ("CHARACTER_DESIGN", character_design_step),
        ("PROP_DESIGN", prop_design_step),
        ("SCENE_DESIGN", scene_design_step),
        ("STORYBOARDING", storyboarding_step),
        ("PROMPT_OPTIMIZATION", prompt_optimization_step),
    ]
    for name, fn in steps:
        await run_step(task_id, name, fn)
```

**目的**：让老用户继续可用，新用户默认进 agent mode。

#### 3.2 任务：单步手动重做 + 反馈

**文件**：`backend/app/agent/tools/asset_tools.py`

```python
class RedoStepTool(Tool):
    """重做历史某一步"""
    name = "redo_step"
    ...

class GetArtifactsTool(Tool):
    """查询已生成资产"""
    name = "get_artifacts"
    ...
```

#### 3.3 任务：失败重试 + 备用模型

```python
# 在 Tool.execute 包装层
class RetryableTool:
    def __init__(self, tool: Tool, max_retries: int = 1, fallback_model: str = None):
        self.tool = tool
        self.max_retries = max_retries
        self.fallback_model = fallback_model

    async def execute(self, runtime, params):
        for attempt in range(self.max_retries + 1):
            try:
                return await self.tool.execute(runtime, params)
            except Exception as e:
                if attempt < self.max_retries:
                    continue
                if self.fallback_model:
                    params["model_id"] = self.fallback_model
                    continue
                raise
```

### Phase 4: 内存 + 上下文 (Week 4)

#### 4.1 任务：Memory 系统

**文件**：`backend/app/agent/memory.py`

```python
class AgentMemory:
    def __init__(self, task_id: str, db: Session):
        self.task_id = task_id
        self.db = db
        self.short_term: list[AgentStep] = []  # 当前任务
        self.long_term = load_user_preferences()  # 跨任务

    def build_react_prompt(self) -> str:
        """构造 ReAct prompt"""
        return f"""
你是 DramaForge Director Agent，正在帮用户完成视频创作任务。

【用户目标】
{self.user_goal}

【已生成的资产】
{json.dumps(self.artifacts_summary(), ensure_ascii=False)}

【历史步骤（最近 10 步）】
{self.format_recent_steps(10)}

【可用工具】
{format_tool_list(self.tools)}

【下一步】
请按以下 JSON 格式回复：
{{
  "thought": "我在想...",
  "action": {{
    "tool": "工具名",
    "params": {{...}}
  }}
}}
"""

    def add_step(self, thought, action, observation):
        step = AgentStep(
            id=gen_id(),
            task_id=self.task_id,
            step_number=len(self.short_term) + 1,
            thought=thought.thought,
            action=action.dict(),
            observation=observation,
            status="success" if observation.get("success") else "failed",
            started_at=datetime.utcnow(),
            finished_at=datetime.utcnow(),
        )
        self.db.add(step)
        self.db.commit()
        self.short_term.append(step)
```

---

## 3. 前端实施 (Week 3-6)

### Phase 5: Agent 状态管理 (Week 3)

#### 5.1 任务：useAgentStore

**文件**：`components/infinite-canvas/use-agent-store.ts`

```typescript
type AgentStore = {
  // 状态
  task: AgentTask | null;
  steps: AgentStep[];
  artifacts: { characters: any[]; props: any[]; scenes: any[]; shots: any[] };
  plan: PlanItem[];
  pendingRequest: PendingRequest | null;  // ask_user / plan_approval
  cost: { tokens: number; usd: number };

  // 操作
  startTask: (goal: string, context: TaskContext) => Promise<void>;
  pauseTask: () => void;
  resumeTask: () => void;
  stopTask: () => void;
  respondToUserRequest: (response: any) => void;
  redoStep: (stepId: string, newParams: any) => void;
};
```

**关键**：
- 通过 SSE 接收后端事件，更新本地状态
- 离线时缓存用户操作，恢复后同步
- 用 immer 做不可变更新

#### 5.2 任务：SSE 客户端

**文件**：`hooks/useAgentStream.ts`

```typescript
export function useAgentStream(taskId: string | null) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    const es = new EventSource(`/api/agent/${taskId}/stream`);

    es.addEventListener("thought", (e) => {
      const event = JSON.parse(e.data);
      setEvents((prev) => [...prev, event]);
    });
    es.addEventListener("action", (e) => { /* ... */ });
    es.addEventListener("observation", (e) => { /* ... */ });
    es.addEventListener("plan_ready", (e) => { /* ... */ });
    es.addEventListener("request_user_input", (e) => { /* ... */ });
    es.addEventListener("done", () => es.close());
    es.addEventListener("failed", () => es.close());

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    return () => es.close();
  }, [taskId]);

  return { events, connected };
}
```

### Phase 6: 任务图画布 (Week 4-5)

#### 6.1 任务：任务图节点组件

**文件**：`components/infinite-canvas/TaskGraphNode.tsx`

支持的 8 种节点类型（见 PRD §7）。每种节点是不同视觉但共享基础结构：

```tsx
interface TaskGraphNodeProps {
  node: TaskGraphNodeData;
  selected: boolean;
  onSelect: () => void;
  onAction: (action: 'pause' | 'modify' | 'cancel' | 'regenerate') => void;
}

const TaskGraphNode: React.FC<TaskGraphNodeProps> = ({ node, ... }) => {
  const VisualComponent = NODE_VISUALS[node.type];  // GoalNode, ActionNode, ...
  return (
    <div className={`task-graph-node task-graph-node-${node.type}`}>
      <VisualComponent node={node} />
      {node.status === 'running' && <PulseRing />}
      {node.status === 'failed' && <ErrorBadge />}
      <NodeActions node={node} onAction={onAction} />
    </div>
  );
};
```

#### 6.2 任务：ThoughtStream

**文件**：`components/infinite-canvas/ThoughtStream.tsx`

```tsx
const ThoughtStream: React.FC<{ events: AgentEvent[] }> = ({ events }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 滚动到底部
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
  }, [events.length]);

  return (
    <div className="thought-stream" ref={containerRef}>
      {events.map((e, i) => (
        <ThoughtBubble key={i} event={e} />
      ))}
    </div>
  );
};

const ThoughtBubble: React.FC<{ event: AgentEvent }> = ({ event }) => {
  if (event.type === 'thought') return <ThoughtBubble body={event.payload.text} />;
  if (event.type === 'action') return <ActionBubble action={event.payload} />;
  if (event.type === 'observation') return <ObservationBubble result={event.payload} />;
  // ...
};
```

#### 6.3 任务：ToolPalette（拖拽面板）

**文件**：`components/infinite-canvas/ToolPalette.tsx`

- 列出所有 18 个工具，按类别分组
- 拖拽到画布上 = 创建"用户指定工具"节点
- 工具 icon + 名称 + 描述 + 预估费用

#### 6.4 任务：PendingApprovalCard

**文件**：`components/infinite-canvas/PendingApprovalCard.tsx`

当 agent 即将调用 `requires_approval=true` 的工具时弹出：

```tsx
<PendingApprovalCard>
  <Header>即将生成：林尘角色三视图</Header>
  <Preview>
    <Image src={referenceImage} />
    <Prompt>...</Prompt>
  </Preview>
  <Model>使用模型：Flux Pro 1.1</Model>
  <Cost>预计：$0.05，25 秒</Cost>
  <Actions>
    <Button onClick={modify}>修改 prompt</Button>
    <Button onClick={changeModel}>换模型</Button>
    <Button onClick={skip}>跳过</Button>
    <Button primary onClick={confirm}>确认生成</Button>
  </Actions>
</PendingApprovalCard>
```

### Phase 7: 任务图交互 (Week 5-6)

#### 7.1 任务：自动布局算法

任务图节点按时间 + 因果关系布局：

- 顶部 = Goal
- 往下 = Plan / 第一批 Action
- 分支 = 横向展开
- 复用 dagre / elk.js 做自动布局

**文件**：`components/infinite-canvas/task-graph-layout.ts`

```typescript
function layoutTaskGraph(steps: AgentStep[]): { nodes: PositionedNode[]; edges: PositionedEdge[] } {
  // 1. 拓扑排序
  // 2. 按时间分层
  // 3. 每层横向展开，避免重叠
  // 4. 边用贝塞尔曲线
}
```

#### 7.2 任务：节点交互

- **点击**：右侧详情面板
- **右键**：上下文菜单（修改、重做、分支、查看 prompt）
- **拖动**：手动调整位置（v1.1 才需要）
- **缩放**：滚轮支持

#### 7.3 任务：详情面板

点击节点显示：
- 完整 thought
- 工具调用参数
- 工具返回结果
- Token 用量 / 成本
- 重做按钮 → 弹修改对话框

### Phase 8: 模式切换 + 兼容 (Week 6)

#### 8.1 任务：Agent 模式入口

**文件**：`components/AgentMode.tsx`

```tsx
const AgentMode: React.FC = () => {
  return (
    <div className="agent-mode">
      <TopBar><GoalInput onStart={startAgent} /></TopBar>
      <LeftPanel><ThoughtStream /></LeftPanel>
      <Canvas><TaskGraph /></Canvas>
      <RightPanel><NodeDetail /></RightPanel>
      <BottomDrawer><ToolPalette /></BottomDrawer>
    </div>
  );
};
```

#### 8.2 任务：Legacy 模式保留

**文件**：`components/LegacyMode.tsx`

保留 `useTaskExecutor.ts` 的 7 步流程，让老用户继续可用。

#### 8.3 任务：模式选择

**文件**：`App.tsx`

```tsx
const App = () => {
  const [mode, setMode] = useState<'agent' | 'legacy'>('agent');
  return mode === 'agent' ? <AgentMode /> : <LegacyMode />;
};
```

在设置中提供切换选项。

---

## 4. 数据迁移

### 4.1 数据库迁移

旧 `tasks` 表（如果存在）→ 新 `agent_tasks` 表：

```python
def migrate_v0_to_v1():
    """v0 旧数据迁移到 v1 agent 模型"""
    for old_task in db.query(OldTask).all():
        new_task = AgentTask(
            id=old_task.id,
            project_id=old_task.project_id,
            user_goal=old_task.raw_novel_text[:100],
            status=old_task.status,
            plan=[],
            artifacts={
                "characters": old_task.characters,
                "props": old_task.props,
                "scenes": old_task.scene_assets,
                "shots": old_task.big_shots,
            },
            total_cost_usd=0,
            total_tokens=0,
        )
        db.add(new_task)
    db.commit()
```

### 4.2 前端数据兼容

旧 localStorage 中的 task 加载时自动迁移到新 store。

---

## 5. 测试计划

### 5.1 后端测试

| 测试类型 | 范围 | 工具 |
|---|---|---|
| 单元测试 | Tool 实现、Memory 类、EventBus | pytest |
| 集成测试 | AgentRuntime + mock LLM | pytest + pytest-asyncio |
| E2E 测试 | SSE 流 → 客户端接收 | httpx + EventSource |
| 负载测试 | 50 并发 agent 任务 | locust |

### 5.2 前端测试

| 测试类型 | 范围 | 工具 |
|---|---|---|
| 组件测试 | TaskGraphNode / ThoughtStream | vitest + @testing-library/react |
| Store 测试 | useAgentStore 状态机 | vitest |
| E2E 测试 | 用户故事 1-6 | Playwright |
| 视觉测试 | 任务图渲染 | Percy/Chromatic |

### 5.3 Agent 行为测试

| 场景 | 预期 |
|---|---|
| 输入"把这段小说变 1 分钟短剧" | 5 步内完成脚本 + 角色 + 场景 + 分镜 |
| 中途修改某分镜 prompt | 该节点重做，下游不变 |
| API 失败 | 自动重试 1 次，换备用模型 1 次 |
| 用户停止 | 任务变 paused，等待指令 |
| Token 用完 | 任务 graceful failed，提示用户 |

---

## 6. 风险与回滚

| 风险 | 检测 | 回滚方案 |
|---|---|---|
| Agent 进入无限循环 | max_steps=30 强制结束 | 显示"agent 卡死，请重试" |
| 旧 7 步流程破坏 | E2E 测试覆盖 | 保留 legacy mode，1 周内可切换 |
| 任务图性能问题 | 1000 节点测试 | 限制单任务最大步骤 |
| 用户数据丢失 | 数据库备份 | 自动每日备份到 .bak |
| LLM API 不可用 | 多 Provider 切换 | 至少 3 个 Provider 兜底 |

---

## 7. 详细时间表

### Week 1 (Backend Foundation)
- [ ] Day 1-2: AgentRuntime + Tool base + Registry
- [ ] Day 3-4: EventBus + SSE Router
- [ ] Day 5: 数据库 schema + 迁移脚本

### Week 2 (Tools Migration)
- [ ] Day 1-2: 6 个 LLM 工具（generate_script 等）
- [ ] Day 3-4: 4 个图像工具 + 1 个视频工具
- [ ] Day 5: 2 个音频工具 + 3 个 planning 工具

### Week 3 (E2E Backend)
- [ ] Day 1-2: Legacy executor 兼容
- [ ] Day 3-4: Memory + ReAct prompt
- [ ] Day 5: 重试 + 备用模型

### Week 4 (Frontend Foundation)
- [ ] Day 1-2: useAgentStore + SSE 客户端
- [ ] Day 3-5: TaskGraphNode + 8 种节点视觉

### Week 5 (Frontend Core)
- [ ] Day 1-2: ThoughtStream + ToolPalette
- [ ] Day 3-4: PendingApprovalCard + 详情面板
- [ ] Day 5: 自动布局算法

### Week 6 (Integration)
- [ ] Day 1-2: AgentMode 容器 + 旧 7 步数据迁移
- [ ] Day 3-4: E2E 测试 + bug 修复
- [ ] Day 5: 性能优化 + 文档

### Week 7-8 (Polish)
- [ ] 内部测试 + 反馈
- [ ] 视觉打磨
- [ ] 上线准备

---

## 8. 监控与日志

### 8.1 后端指标

- Agent 任务成功率
- 平均完成步数
- 工具调用次数（按工具名）
- LLM token 用量（按模型）
- API 失败率（按 provider）
- 任务总耗时分布

### 8.2 前端指标

- 任务图渲染性能（FPS）
- ThoughtStream 滚动流畅度
- SSE 连接稳定性
- 用户介入率

### 8.3 业务指标

- 日活任务数
- 任务完成率
- 平均任务费用
- 重复使用率

---

## 9. 后续工作 (v1.1+)

- [ ] 模板市场（用户分享 agent 配置）
- [ ] 多 Agent 协作（编剧 + 导演 + 摄影）
- [ ] 语音输入
- [ ] 移动端适配
- [ ] 协作模式（多人同任务）

---

> **下一步**：阅读 [tech-design.md](./tech-design.md) 查看关键模块的技术细节。
