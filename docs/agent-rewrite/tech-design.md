# DramaForge AI — Agent 化重构技术设计

> **版本**：v1.0
> **日期**：2026-06-30
> **依赖**：[PRD.md](./PRD.md)、[plan.md](./plan.md)

本文档聚焦关键技术决策的实现细节，作为开发的参考手册。

---

## 1. ReAct Loop 实现

### 1.1 核心流程

```python
# 简化的 ReAct 循环
async def react_loop(runtime):
    while not runtime.is_done() and runtime.step_count < MAX_STEPS:
        # 1. 思考
        thought = await runtime.think()
        runtime.emit("thought", thought)

        # 2. 决策（基于 thought）
        action = parse_action(thought)  # 可能是 ask_user / tool_call / finish

        # 3. 执行
        if action.is_ask_user:
            # 暂停，等待用户
            user_input = await runtime.wait_for_user_input()
            observation = user_input
        elif action.is_finish:
            runtime.mark_done()
            break
        else:
            # 调用工具
            observation = await runtime.call_tool(action)

        # 4. 记录
        runtime.add_step(thought, action, observation)
        runtime.emit("observation", observation)
```

### 1.2 ReAct Prompt 模板

```python
REACT_SYSTEM_PROMPT = """你是 DramaForge Director Agent，一个 20 年经验的短剧导演。

【工作方法】
1. 仔细阅读【当前状态】和【已生成资产】
2. 在 thought 中写出你接下来的思路（不超过 100 字）
3. 在 action 中决定调用哪个工具，参数必须严格符合 schema
4. 如果用户必须参与决策，调 ask_user 工具
5. 如果所有任务完成，调 finish_task 工具

【输出格式（严格 JSON）】
{
  "thought": "我决定先...因为...",
  "action": {
    "tool": "工具名",
    "params": { ... }
  }
}
"""
```

### 1.3 决策边界

LLM 在以下场景下应调 `ask_user`：
- 用户目标模糊，需要澄清
- 有多个合理方向，让用户选
- 即将调用高成本工具前，确认是否继续

LLM 在以下场景下应调 `finish_task`：
- 所有 Plan 中的步骤都已完成
- 无法继续（API 不可用、用户已停止）

---

## 2. 工具协议

### 2.1 工具定义 schema

```python
class Tool(BaseModel):
    name: str                                       # 唯一标识
    description: str                                # LLM 看到的描述（最重要）
    category: Literal["planning", "llm", "image", "video", "audio", "asset-mgmt"]
    parameters: dict                                # JSON Schema
    requires_approval: bool = False
    estimated_cost_usd: float = 0.0
    estimated_time_sec: float = 0.0
    idempotent: bool = False                        # 是否可安全重试
```

### 2.2 工具实现接口

```python
class ToolImpl(Protocol):
    async def execute(self, ctx: ToolContext, params: dict) -> dict: ...
    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        """返回 None 表示 OK，否则返回错误信息"""
        ...

class ToolContext:
    """工具执行上下文"""
    task_id: str
    project_id: str
    db: Session
    llm_client: LLMClient
    api_config: ApiConfig
    global_refs: list[AssetRef]      # 全局参考图
    artifacts: Artifacts             # 已生成资产
    emit: Callable[[str, dict], None]  # 发送事件给前端
```

### 2.3 工具注册示例

```python
# tools/image_tools.py
def register_image_tools(registry: ToolRegistry):
    registry.register(GenerateCharacterPortraitTool(...))
    registry.register(GeneratePropImageTool(...))
    registry.register(GenerateSceneImageTool(...))
    registry.register(GenerateStoryboardImageTool(...))

# 启动时
def bootstrap_tools():
    registry = ToolRegistry()
    register_planning_tools(registry)
    register_llm_tools(registry)
    register_image_tools(registry)
    register_video_tools(registry)
    register_audio_tools(registry)
    register_asset_tools(registry)
    return registry
```

---

## 3. SSE 事件协议

### 3.1 事件类型

| 事件名 | 触发时机 | payload |
|---|---|---|
| `task_started` | agent 启动 | `{ goal, task_id }` |
| `thought` | LLM 思考完成 | `{ step_id, text, duration_ms }` |
| `action` | LLM 决定调用工具 | `{ step_id, tool, params, requires_approval }` |
| `observation` | 工具返回结果 | `{ step_id, success, result, error?, cost_usd, tokens, duration_ms }` |
| `plan_ready` | plan 创建完成 | `{ plan: PlanItem[] }` |
| `plan_revised` | plan 修改后 | `{ plan }` |
| `request_user_input` | ask_user | `{ step_id, question, options? }` |
| `user_input_received` | 用户响应 | `{ step_id, response }` |
| `artifact_created` | 新资产生成 | `{ type, id, url, metadata }` |
| `cost_update` | 累计成本 | `{ total_usd, total_tokens }` |
| `task_paused` | 任务暂停 | `{ step_id }` |
| `task_resumed` | 任务恢复 | `{}` |
| `task_done` | 任务完成 | `{ summary }` |
| `task_failed` | 任务失败 | `{ error }` |

### 3.2 事件传输格式

```
event: thought
data: {"step_id": "step_5", "text": "我决定先做角色设计", "duration_ms": 1234}
id: 5

event: action
data: {"step_id": "step_5", "tool": "generate_character_portrait", "params": {...}}
id: 6
```

### 3.3 前端订阅

```typescript
const eventSource = new EventSource(`/api/agent/${taskId}/stream`);

const handlers: Record<string, (e: MessageEvent) => void> = {
  thought: (e) => addThought(JSON.parse(e.data)),
  action: (e) => addAction(JSON.parse(e.data)),
  observation: (e) => addObservation(JSON.parse(e.data)),
  plan_ready: (e) => setPlan(JSON.parse(e.data).plan),
  request_user_input: (e) => showAskUserDialog(JSON.parse(e.data)),
  artifact_created: (e) => addArtifact(JSON.parse(e.data)),
  task_done: () => eventSource.close(),
  task_failed: (e) => showError(JSON.parse(e.data)),
};

Object.entries(handlers).forEach(([event, handler]) => {
  eventSource.addEventListener(event, handler);
});
```

---

## 4. 状态管理

### 4.1 后端状态

```python
# 任务状态机
TASK_STATES = {
  "pending": {"running", "failed"},
  "running": {"paused", "done", "failed"},
  "paused": {"running", "failed"},
  "done": set(),
  "failed": set(),
}

# 步骤状态机
STEP_STATES = {
  "pending": {"running", "skipped"},
  "running": {"success", "failed", "retrying"},
  "retrying": {"running", "failed", "success"},
  "success": set(),
  "failed": {"retrying", "skipped"},
  "skipped": set(),
}
```

### 4.2 持久化策略

```python
# 每次状态变化都立即持久化
async def update_step_status(step_id: str, status: str):
    step = db.query(AgentStep).get(step_id)
    step.status = status
    if status == "running":
        step.started_at = datetime.utcnow()
    elif status in ("success", "failed", "skipped"):
        step.finished_at = datetime.utcnow()
    db.commit()
    # 发送事件
    await event_bus.publish(AgentEvent(
        task_id=step.task_id,
        step_id=step.id,
        type=f"step_{status}",
        payload={...},
    ))
```

### 4.3 断点续传

```python
async def resume_task(task_id: str):
    """从数据库恢复 task 状态，继续执行"""
    task = db.query(AgentTask).get(task_id)
    if task.status != "paused":
        raise ValueError(f"Cannot resume task in status {task.status}")

    # 恢复 memory
    steps = db.query(AgentStep).filter_by(task_id=task_id).all()
    memory = AgentMemory.from_steps(steps)

    # 恢复 runtime
    runtime = AgentRuntime(task_id, db, memory)
    runtime.status = "running"

    # 继续 ReAct loop（从下一个 step 开始）
    await runtime.continue_loop()
```

---

## 5. 前端任务图画布

### 5.1 节点数据结构

```typescript
type TaskGraphNode =
  | { type: 'goal'; id: string; x: number; y: number; data: { userGoal: string } }
  | { type: 'plan'; id: string; x: number; y: number; data: { items: PlanItem[]; status: 'pending' | 'approved' | 'rejected' } }
  | { type: 'decision'; id: string; x: number; y: number; data: { text: string; alternatives?: string[] } }
  | { type: 'action'; id: string; x: number; y: number; data: { tool: string; params: any; status: StepStatus; costUsd: number; durationMs: number } }
  | { type: 'artifact'; id: string; x: number; y: number; data: { artifactType: string; url: string; title: string; thumbnailUrl?: string } }
  | { type: 'user'; id: string; x: number; y: number; data: { question: string; response?: string } }
  | { type: 'error'; id: string; x: number; y: number; data: { error: string; recoveryOptions: string[] } }
  | { type: 'branch'; id: string; x: number; y: number; data: { fromArtifactId: string; branchName: string } };

type TaskGraphEdge = {
  id: string;
  from: string;
  to: string;
  type: 'dependency' | 'alternative' | 'redo';
};
```

### 5.2 自动布局算法

```typescript
function autoLayout(nodes: TaskGraphNode[], edges: TaskGraphEdge[]): TaskGraphNode[] {
  // 1. 构建 DAG
  const dag = buildDAG(nodes, edges);

  // 2. 拓扑排序
  const levels = topologicalLevels(dag);

  // 3. 每层从左到右展开
  return nodes.map(node => {
    const level = levels.get(node.id) || 0;
    const indexInLevel = levelNodes[level].indexOf(node.id);
    return {
      ...node,
      x: (indexInLevel - levelNodes[level].length / 2) * NODE_WIDTH + level * LEVEL_GAP_X,
      y: level * LEVEL_GAP_Y,
    };
  });
}

function topologicalLevels(dag: DAG): Map<string, number> {
  // BFS 计算每个节点的最长路径层数
  const inDegree = computeInDegree(dag);
  const levels = new Map<string, number>();
  const queue: string[] = [];

  dag.nodes.forEach(n => {
    if (inDegree.get(n) === 0) {
      levels.set(n, 0);
      queue.push(n);
    }
  });

  while (queue.length) {
    const node = queue.shift();
    const level = levels.get(node);
    dag.successors(node).forEach(succ => {
      const newLevel = Math.max(levels.get(succ) || 0, level + 1);
      levels.set(succ, newLevel);
      const newInDegree = inDegree.get(succ) - 1;
      inDegree.set(succ, newInDegree);
      if (newInDegree === 0) queue.push(succ);
    });
  }

  return levels;
}
```

### 5.3 节点视觉规范

```css
/* 8 种节点共用样式 */
.task-graph-node {
  position: absolute;
  background: var(--bg-1);
  border: 1.5px solid var(--line);
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.task-graph-node.running { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
.task-graph-node.success { border-color: #10b981; }
.task-graph-node.failed  { border-color: #ef4444; }
.task-graph-node.paused  { border-color: #f59e0b; }

@keyframes pulse-ring {
  0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); }
  70% { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
  100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
}
.task-graph-node.running { animation: pulse-ring 1.5s infinite; }

/* 节点类型特有样式 */
.task-graph-node-goal { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
.task-graph-node-plan { background: #fef3c7; border-color: #fbbf24; }
.task-graph-node-decision { background: #dbeafe; border-color: #3b82f6; transform: rotate(45deg); }
.task-graph-node-artifact { padding: 8px; }
.task-graph-node-artifact img { max-width: 200px; border-radius: 6px; }
.task-graph-node-user { background: #f3e8ff; border-color: #a855f7; }
```

---

## 6. 状态共享：无限画布 ↔ 任务图

画布基础设施（拖动、缩放、选中）继续复用 `infinite-canvas/` 目录，但节点渲染改为任务图节点：

```typescript
// components/infinite-canvas/TaskGraphCanvas.tsx
export const TaskGraphCanvas: React.FC = () => {
  const agentStore = useAgentStore();
  const nodes = computeLayoutedTaskGraph(agentStore.steps, agentStore.artifacts);

  return (
    <Canvas>
      <CanvasEdges edges={edges} />
      {nodes.map(node => (
        <CanvasNode
          key={node.id}
          id={node.id}
          x={node.x}
          y={node.y}
          data={node}
          component={TaskGraphNode}  // ← 注入任务图节点组件
        />
      ))}
    </Canvas>
  );
};
```

---

## 7. LLM 集成

### 7.1 Provider 抽象

```python
class LLMClient:
    """统一 LLM 客户端，包装 OpenAI / Anthropic / 自定义 HTTP"""

    def __init__(self, provider: Provider, model: ModelConfig):
        self.provider = provider
        self.model = model

    async def generate(
        self,
        messages: list[dict],
        response_format: type[BaseModel] | None = None,
        tools: list[dict] | None = None,  # OpenAI function calling
        temperature: float = 0.7,
        max_tokens: int = 4000,
    ) -> LLMResponse:
        """调用 LLM，返回统一格式响应"""
        if self.provider.protocol == "openai":
            return await self._call_openai(messages, response_format, tools, temperature, max_tokens)
        elif self.provider.protocol == "anthropic":
            return await self._call_anthropic(messages, response_format, tools, temperature, max_tokens)
        # ... 其他 provider

    async def stream(
        self,
        messages: list[dict],
        response_format: type[BaseModel] | None = None,
    ) -> AsyncIterator[str]:
        """流式响应（用于 thought 实时显示）"""
        # ...
```

### 7.2 Structured Output

所有 LLM 调用都用 Pydantic 强制结构化输出：

```python
class ReActDecision(BaseModel):
    thought: str = Field(description="Agent 思考过程，50-200 字")
    action: Action = Field(description="决定调用的工具或操作")

class Action(BaseModel):
    tool: Literal["ask_user", "finish_task"] | str  # 工具名
    params: dict = Field(default_factory=dict)

# 调用
decision = await llm.generate_structured(
    messages=[{"role": "system", "content": REACT_SYSTEM_PROMPT}, ...],
    response_format=ReActDecision,
)
```

### 7.3 ReAct Prompt 构建

```python
def build_react_prompt(runtime) -> str:
    sections = []

    # 1. 角色定义
    sections.append("你是 DramaForge Director Agent...")

    # 2. 用户目标
    sections.append(f"【用户目标】\n{runtime.task.user_goal}")

    # 3. 计划
    if runtime.task.plan:
        sections.append("【计划】\n" + format_plan(runtime.task.plan))

    # 4. 已生成资产摘要
    artifacts = runtime.memory.artifacts_summary()
    if artifacts:
        sections.append(f"【已生成资产】\n{artifacts}")

    # 5. 最近 10 步
    recent = runtime.memory.short_term[-10:]
    if recent:
        sections.append("【最近步骤】\n" + format_steps(recent))

    # 6. 可用工具
    sections.append("【可用工具】\n" + format_tools(runtime.tools.list()))

    # 7. 输出格式
    sections.append("【输出格式】\n" + REACT_OUTPUT_FORMAT)

    return "\n\n".join(sections)
```

---

## 8. 失败恢复

### 8.1 失败分类

| 错误类型 | 重试策略 | 用户介入 |
|---|---|---|
| 网络超时 | 重试 3 次（指数退避） | 不需要 |
| 401/403 (Auth) | 不重试 | 必须重新配置 API Key |
| 429 (Rate Limit) | 等 60s 重试 | 不需要 |
| 500 (Server) | 重试 1 次 | 不需要 |
| 400 (Bad Request) | 不重试 | 显示错误，让用户改 prompt |
| Tool 不存在 | 不重试 | 显示错误给 agent，让其换工具 |
| LLM 决策失败（无法解析） | 重新调用 LLM | 不需要 |

### 8.2 实现

```python
class RetryableTool:
    def __init__(self, tool: Tool, policy: RetryPolicy = None):
        self.tool = tool
        self.policy = policy or DEFAULT_RETRY_POLICY

    async def execute(self, ctx, params):
        last_error = None
        for attempt in range(self.policy.max_retries + 1):
            try:
                return await self.tool.execute(ctx, params)
            except RetryableError as e:
                last_error = e
                if attempt < self.policy.max_retries:
                    await asyncio.sleep(self.policy.backoff(attempt))
                    continue
                # 尝试备用模型
                if self.policy.fallback_model:
                    ctx = ctx.with_model(self.policy.fallback_model)
                    continue
                raise
            except NonRetryableError as e:
                raise
        raise last_error
```

### 8.3 用户恢复 UI

```tsx
const ErrorRecoveryCard: React.FC<{ step: AgentStep }> = ({ step }) => {
  return (
    <div className="error-recovery-card">
      <Header>步骤失败：{step.action.tool}</Header>
      <ErrorMessage>{step.observation.error}</ErrorMessage>
      <Options>
        <Button onClick={() => retryStep(step.id)}>
          重试（已自动重试 1 次）
        </Button>
        <Button onClick={() => changeModelAndRetry(step.id)}>
          换模型后重试
        </Button>
        <Button onClick={() => skipStep(step.id)}>
          跳过此步
        </Button>
        <Button onClick={() => pauseAndAsk(step.id)}>
          让 agent 重新决策
        </Button>
      </Options>
    </div>
  );
};
```

---

## 9. 性能与扩展

### 9.1 LLM 调用优化

- **批量调用**：多个独立的小任务合并成一次 LLM 调用
- **Prompt 缓存**：相同 system prompt 缓存（Anthropic 支持）
- **Token 预算**：每个任务最大 100k tokens，超出强制停止
- **并行执行**：独立步骤并行（用 asyncio.gather）

### 9.2 前端渲染优化

- **虚拟化**：任务图节点超过 100 个时只渲染视口内
- **缩略图缓存**：Artifact 缩略图用 IndexedDB 缓存
- **SSE 批处理**：每 100ms 合并一次 event 推送，避免频繁渲染
- **WebWorker**：自动布局算法放 Worker

### 9.3 数据库优化

- 任务图节点 > 1000 时归档
- AgentStep 表加 `task_id` 索引
- Artifacts 用单独表 + 外键

---

## 10. 安全考虑

### 10.1 API Key 保护

- 用户 API Key 在后端加密存储（AES-256）
- 传给 LLM Provider 时 HTTPS
- 日志中绝不打印 API Key

### 10.2 Prompt Injection 防御

```python
# 用户输入验证
def sanitize_user_input(text: str) -> str:
    """清理可能的 prompt injection"""
    # 1. 长度限制
    if len(text) > 100_000:
        raise ValueError("Input too long")
    # 2. 检测可疑模式
    if contains_injection_pattern(text):
        raise ValueError("Suspicious input detected")
    # 3. 包裹用户输入
    return f"<user_input>\n{text}\n</user_input>"
```

### 10.3 工具调用 sandbox

```python
class ToolSandbox:
    """工具执行环境隔离"""

    def __init__(self, max_execution_time: int = 300):
        self.max_execution_time = max_execution_time

    async def execute(self, tool: Tool, ctx: ToolContext, params: dict):
        try:
            return await asyncio.wait_for(
                tool.execute(ctx, params),
                timeout=self.max_execution_time,
            )
        except asyncio.TimeoutError:
            raise ToolTimeoutError(f"Tool {tool.name} exceeded {self.max_execution_time}s")
```

---

## 11. 部署与发布

### 11.1 灰度发布

- [ ] 第 1 周：内部用户（< 10 人）使用 agent 模式
- [ ] 第 2 周：10% 用户开启 agent mode 选项
- [ ] 第 3 周：50% 用户
- [ ] 第 4 周：100% 用户，legacy mode 标记 deprecated

### 11.2 数据库迁移

```bash
# 启动前自动执行
python -m app.migrations.add_agent_tables
python -m app.migrations.migrate_v0_to_v1
```

### 11.3 监控

- Sentry：前端 + 后端错误
- Datadog：API 延迟 + token 用量
- 自建 dashboard：agent 决策成功率、工具调用分布

---

## 12. 关键代码片段参考

### 12.1 Tool 实现模板

```python
from .base import Tool, ToolContext, ToolParameter

class GenerateCharacterPortraitTool(Tool):
    name = "generate_character_portrait"
    description = """根据角色定义生成三视图（正面/侧面/背面）。
    使用场景：用户想看角色长什么样。
    输入：character 字典（包含 faceAnchor/hairSystem/clothingLayers 等）。
    输出：图片 URL。"""
    category = "image"
    requires_approval = True
    estimated_cost_usd = 0.05
    estimated_time_sec = 25.0
    idempotent = True

    parameters = [
        ToolParameter(
            name="character",
            type="object",
            description="角色定义字典，必须包含 name / faceAnchor / hairSystem / clothingLayers",
        ),
        ToolParameter(
            name="composition",
            type="string",
            description="图片构图",
            enum=["threeView", "portrait", "fullBody"],
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if "character" not in params:
            return "Missing required parameter: character"
        char = params["character"]
        if not char.get("faceAnchor"):
            return "character.faceAnchor is required"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        # 1. 构造 prompt
        char = params["character"]
        composition = params.get("composition", "threeView")
        prompt = build_character_portrait_prompt(char, composition)

        # 2. 调用图像生成
        provider = ctx.api_config.get_provider("characterDesign")
        model = ctx.api_config.get_model("characterDesign")
        url = await generate_image(prompt, provider, model, ctx.global_refs)

        # 3. 保存到资产库
        artifact = ctx.save_artifact(
            kind="character",
            name=char["name"],
            url=url,
            prompt=prompt,
            metadata={"character_id": char.get("id")},
        )

        return {"url": url, "artifact_id": artifact.id, "name": char["name"]}
```

### 12.2 前端 Thought Stream 组件

```typescript
const ThoughtStream: React.FC<{ events: AgentEvent[] }> = ({ events }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // 智能滚动
  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    containerRef.current.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [events.length, autoScroll]);

  // 用户滚回顶部时停止自动滚动
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollTop + clientHeight >= scrollHeight - 50);
  };

  return (
    <div className="thought-stream" ref={containerRef} onScroll={handleScroll}>
      {events.map((event, i) => (
        <EventBubble key={i} event={event} />
      ))}
      {!autoScroll && (
        <button
          className="resume-scroll-btn"
          onClick={() => setAutoScroll(true)}
        >
          ↓ 跟随最新
        </button>
      )}
    </div>
  );
};
```

### 12.3 任务图节点：Action 节点

```typescript
const ActionNode: React.FC<{ node: TaskGraphNode & { type: 'action' } }> = ({ node }) => {
  const { tool, params, status, costUsd, durationMs } = node.data;
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className={`task-graph-node action-node ${status}`}>
      <div className="node-icon">
        <ToolIcon name={tool} />
      </div>
      <div className="node-title">{formatToolName(tool)}</div>
      <div className="node-meta">
        <span>${costUsd.toFixed(3)}</span>
        <span>{(durationMs / 1000).toFixed(1)}s</span>
        {status === 'running' && <Spinner />}
        {status === 'failed' && <ErrorIcon />}
        {status === 'success' && <CheckIcon />}
      </div>
      <div className="node-actions">
        <button onClick={() => setShowDetail(true)}>查看</button>
        {status === 'success' && (
          <button onClick={() => regenerateNode(node.id)}>重做</button>
        )}
      </div>
      {showDetail && (
        <ActionDetailDialog
          node={node}
          onClose={() => setShowDetail(false)}
        />
      )}
    </div>
  );
};
```

---

## 13. 关键设计决策记录（ADR）

### ADR-001: Agent 决策放在后端

**决策**：所有 LLM 决策在 FastAPI 后端执行，前端只做展示。

**理由**：
- API Key 不暴露给前端
- 决策可持久化（断点续传）
- 跨用户共享 LLM 配置
- 后端可加缓存、限流、监控

**代价**：每次 LLM 决策有网络延迟（~100ms），但 Thought Stream 是异步的，不影响 UX。

### ADR-002: SSE 而非 WebSocket

**决策**：用 Server-Sent Events 推送 agent 事件。

**理由**：
- 单向推送足够（前端只接收，后端用 POST 发送用户响应）
- HTTP/2 多路复用友好
- 断线重连内置
- 防火墙友好

**代价**：不能双向通信，但 ask_user 用 POST 解决。

### ADR-003: 强制 Plan 阶段

**决策**：每个任务开始必须先有 Plan，用户审核后才执行。

**理由**：
- 防止 LLM 乱决策
- 给用户"知情同意"
- 早期发现方向错误

**代价**：额外一轮 LLM 调用（~3-5s）和用户点击，但显著降低后期返工。

### ADR-004: 旧 7 步作为 legacy 模式保留

**决策**：v1.0 同时保留旧 7 步流程，不强制迁移。

**理由**：
- 老用户无感
- 旧流程作为 agent 工具的"快速通道"
- 灰度发布更安全

**代价**：代码重复（~30%），但 v1.1 旧流程会标 deprecated，v2.0 删除。

### ADR-005: 工具调用需用户审核

**决策**：以下工具必须先经用户确认：`generate_character_portrait`、`generate_scene_image`、`generate_storyboard_image`、`generate_video`、`ask_user`、`create_plan`。

**理由**：
- 成本高（>$0.05）
- 不可逆（生成图片/视频）
- 用户应参与创意决策

**代价**：增加点击次数，但提升用户控制感。

---

## 14. 待讨论

- [ ] Plan 阶段用户审核 UI：是模态框还是侧栏？
- [ ] 工具调用的最大重试次数：1 次够吗？
- [ ] 任务图最大节点数：100 / 200 / 500？
- [ ] Plan 是否允许用户在执行中修改？
- [ ] 失败任务是否自动归档？

---

> **审阅 checklist**：
> - [ ] ReAct Loop 逻辑是否合理？
> - [ ] Tool 抽象是否足够灵活？
> - [ ] SSE 事件是否覆盖所有场景？
> - [ ] 前端任务图渲染性能是否可接受？
> - [ ] 旧 7 步迁移策略是否安全？
> - [ ] 灰度发布计划是否清晰？
