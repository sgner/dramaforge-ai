# AgentMode + 工具远端化 + 任务列表 + SSE 优化 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在前端组装 AgentMode 页面（复用现有 InfiniteCanvas），后端补齐 `/api/agent/tools` 端点和 `create_plan → memory.plan` 桥接，前端加 useAgentTools（含 fallback）、TaskList 组件、useAgentStream 指数退避。

**Architecture:** 后端 FastAPI 增加 2 个端点 + runtime 1 处桥接；前端 zustand store 不动，3 个 hook 增强 + 2 个新组件 + 1 个顶级页面。架构图见 spec (SVG)。

**Tech Stack:** 后端 FastAPI + Pydantic + uv；前端 React 19 + zustand + vitest + @testing-library/react + happy-dom。

**Spec:** [2026-06-30-agent-mode-design.md](../specs/2026-06-30-agent-mode-design.md)

## Global Constraints

- 现有 53 个前端测试 + 123 个后端测试必须全过
- 不动 `useAgentStore` 的对外 API
- 不动 18 工具的 `name`/`category` 字段
- 前端画布**复用现有 InfiniteCanvas**（自定义实现，非 react flow）
- 架构图统一用 SVG 绘制
- Python 包管理使用 uv（不要用系统 Python）
- 每个 Task 结尾独立可测；每个 Step 含实际代码（无 placeholder）

---

## Task 1: 后端 — runtime 把 `create_plan` 输出桥接到 `memory.plan`

**Files:**
- Modify: `backend/app/agent/runtime.py:155-175`（在 `_execute_tool` 后增加桥接逻辑）
- Test: `backend/tests/test_agent_runtime_create_plan_bridge.py`

**Interfaces:**
- Consumes: `memory.plan: list[dict] | None`，`tool_name == "create_plan"` 时的 `observation.result`
- Produces: 当 create_plan 成功时，`memory.plan` 被设置为 `result`（list）

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_agent_runtime_create_plan_bridge.py
import asyncio
import pytest
from app.agent.llm import LLMResponse
from app.agent.memory import AgentMemory
from app.agent.runtime import AgentRuntime
from app.agent.tools import build_default_registry
from app.agent.tools.planning import CreatePlanTool
from app.agent.media_service import StubMediaService

PLAN = [{"step": 1, "tool": "x"}, {"step": 2, "tool": "y"}]


class StaticLLM:
    model = "stub"
    def __init__(self, name, args):
        self._name = name
        self._args = args
        self.calls = []
    async def generate(self, messages, tools=None, **kw):
        self.calls.append(messages)
        return LLMResponse(tool_name=self._name, tool_args=self._args, cost_usd=0)
    async def generate_structured(self, *a, **kw):
        return await self.generate(*a, **kw)


@pytest.mark.asyncio
async def test_create_plan_writes_result_to_memory_plan():
    llm = StaticLLM("create_plan", {"goal": {"title": "x"}})
    memory = AgentMemory(user_goal="x")
    registry = build_default_registry()
    for t in registry.list():
        t._media_service = StubMediaService()
    # stub create_plan.execute
    original = CreatePlanTool.execute
    async def stub(self, ctx, params):
        return list(PLAN)
    CreatePlanTool.execute = stub
    try:
        runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory, registry=registry, max_steps=3)
        for _ in range(5):
            if await runtime.step():
                break
    finally:
        CreatePlanTool.execute = original
    assert memory.plan is not None
    assert len(memory.plan) == 2
    assert memory.plan[0]["step"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_agent_runtime_create_plan_bridge.py -v --tb=short`
Expected: FAIL — `memory.plan is None` (或 `assert None is not None`)

- [ ] **Step 3: Implement the bridge in runtime**

修改 `backend/app/agent/runtime.py`，在 step 内 tool 执行成功后（约 line 175，after `await self._emit(EventType.OBSERVATION, ...)`）增加：

```python
# bridge: create_plan → memory.plan
if tool_name == "create_plan" and isinstance(observation, dict) and isinstance(observation.get("result"), list):
    self.memory.plan = observation["result"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_agent_runtime_create_plan_bridge.py -v --tb=short`
Expected: PASS

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && uv run pytest`
Expected: 124 passed (was 123, +1 new test)

- [ ] **Step 6: Commit**

```bash
git add backend/app/agent/runtime.py backend/tests/test_agent_runtime_create_plan_bridge.py
git commit -m "feat(runtime): bridge create_plan result to memory.plan"
```

---

## Task 2: 后端 — `list_tool_metadata()` + `GET /api/agent/tools`

**Files:**
- Modify: `backend/app/agent/tools/__init__.py`（+`list_tool_metadata()` 函数）
- Modify: `backend/app/routers/agent.py`（+`GET /tools` endpoint）
- Modify: `backend/app/schemas.py`（+`ToolMetadataOut` Pydantic model）
- Test: `backend/tests/test_agent_tools_metadata.py`

**Interfaces:**
- Consumes: `build_default_registry()` 返回 18 个工具实例
- Produces: `list[dict(name, description, category, requires_approval)]`

- [ ] **Step 1: Write the failing test for list_tool_metadata**

```python
# backend/tests/test_agent_tools_metadata.py
from app.agent.tools import list_tool_metadata

def test_list_tool_metadata_returns_18():
    meta = list_tool_metadata()
    assert len(meta) == 18

def test_list_tool_metadata_has_required_fields():
    meta = list_tool_metadata()
    for m in meta:
        assert "name" in m
        assert "description" in m
        assert "category" in m
        assert "requires_approval" in m

def test_list_tool_metadata_categories_match_all_tools():
    from app.agent.tools import build_default_registry
    expected = {t().name: t().category for t in build_default_registry().list()}
    expected = {n: c for n, c in zip([], [])}  # placeholder replaced below
    # 实际断言：
    meta = {m["name"]: m["category"] for m in list_tool_metadata()}
    assert meta["parse_user_goal"] == "planning"
    assert meta["generate_script"] == "llm"
    assert meta["generate_video"] == "video"
    assert meta["save_asset"] == "asset"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_agent_tools_metadata.py -v --tb=short`
Expected: FAIL — `AttributeError: module 'app.agent.tools' has no attribute 'list_tool_metadata'`

- [ ] **Step 3: Implement list_tool_metadata**

修改 `backend/app/agent/tools/__init__.py` 文件末尾，添加：

```python
def list_tool_metadata() -> list[dict]:
    """导出 18 个工具的元数据给前端 ToolPalette。"""
    from .base import BaseTool
    out: list[dict] = []
    for cls in ALL_TOOLS:
        inst = cls()
        if not isinstance(inst, BaseTool):
            continue
        out.append({
            "name": inst.name,
            "description": inst.description,
            "category": inst.category,
            "requires_approval": bool(getattr(inst, "requires_approval", False)),
        })
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_agent_tools_metadata.py::test_list_tool_metadata_returns_18 tests/test_agent_tools_metadata.py::test_list_tool_metadata_has_required_fields tests/test_agent_tools_metadata.py::test_list_tool_metadata_categories_match_all_tools -v --tb=short`
Expected: 3 passed

- [ ] **Step 5: Write failing test for GET /api/agent/tools**

```python
# 在 backend/tests/test_agent_tools_metadata.py 末尾追加：

def test_get_agent_tools_route_returns_18(client):
    res = client.get("/api/agent/tools")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) == 18
    assert all("name" in item and "category" in item for item in data)
```

> 注：`client` 是 conftest.py 已提供的 `TestClient` fixture（app）。

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_agent_tools_metadata.py::test_get_agent_tools_route_returns_18 -v --tb=short`
Expected: FAIL — 404

- [ ] **Step 7: Add Pydantic model + endpoint**

修改 `backend/app/schemas.py`（文件末尾追加）：

```python
class ToolMetadataOut(BaseModel):
    name: str
    description: str
    category: str
    requires_approval: bool
    model_config = ConfigDict(from_attributes=True)
```

修改 `backend/app/routers/agent.py`，在合适位置增加：

```python
from .. import schemas
from ..agent.tools import list_tool_metadata

@router.get("/tools", response_model=list[schemas.ToolMetadataOut])
def get_agent_tools():
    return list_tool_metadata()
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_agent_tools_metadata.py -v --tb=short`
Expected: 4 passed

- [ ] **Step 9: Run full backend suite**

Run: `cd backend && uv run pytest`
Expected: 127 passed (was 124, +3 new tests)

- [ ] **Step 10: Commit**

```bash
git add backend/app/agent/tools/__init__.py backend/app/routers/agent.py backend/app/schemas.py backend/tests/test_agent_tools_metadata.py
git commit -m "feat(api): GET /api/agent/tools returns 18 tool metadata"
```

---

## Task 3: 后端 — `GET /api/agent/tasks?project_id=X` 列出任务

**Files:**
- Modify: `backend/app/routers/agent.py`（+`GET /tasks` 列表 endpoint，含 project_id query）
- Test: `backend/tests/test_agent_tasks_list.py`

**Interfaces:**
- Consumes: `models.AgentTask`，query param `project_id: Optional[str]`
- Produces: `list[AgentTaskOut]`，按 `created_at desc`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_agent_tasks_list.py
import uuid


def _create_task(client, project_id="p1", goal="test"):
    return client.post("/api/agent/tasks", json={
        "project_id": project_id,
        "user_goal": goal,
    })


def test_list_tasks_returns_200_with_array(client):
    res = client.get("/api/agent/tasks")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_list_tasks_filtered_by_project_id(client):
    pid = f"p-{uuid.uuid4().hex[:8]}"
    _create_task(client, project_id=pid, goal="a")
    _create_task(client, project_id=pid, goal="b")
    _create_task(client, project_id="other-project", goal="c")
    res = client.get(f"/api/agent/tasks?project_id={pid}")
    assert res.status_code == 200
    data = res.json()
    assert all(t.get("project_id") == pid for t in data)
    assert len(data) >= 2


def test_list_tasks_empty_project_returns_empty_array(client):
    res = client.get("/api/agent/tasks?project_id=non-existent-xyz")
    assert res.status_code == 200
    assert res.json() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_agent_tasks_list.py -v --tb=short`
Expected: FAIL — 404 或返回非 list

- [ ] **Step 3: Implement the endpoint**

修改 `backend/app/routers/agent.py`，在合适位置增加：

```python
from typing import Optional
from fastapi import Query
from .. import models as orm_models


@router.get("", response_model=list[schemas.AgentTaskOut])
def list_agent_tasks(
    project_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(orm_models.AgentTask)
    if project_id is not None:
        q = q.filter(orm_models.AgentTask.project_id == project_id)
    return q.order_by(orm_models.AgentTask.created_at.desc()).all()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_agent_tasks_list.py -v --tb=short`
Expected: 3 passed

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && uv run pytest`
Expected: 130 passed (was 127, +3 new tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/agent.py backend/tests/test_agent_tasks_list.py
git commit -m "feat(api): GET /api/agent/tasks?project_id=X lists tasks"
```

---

## Task 4: 前端 — `useAgentTools()` hook（远端 + fallback）

**Files:**
- Create: `agent/use-agent-tools.ts`
- Test: `tests/agent/use-agent-tools.test.tsx`

**Interfaces:**
- Consumes: `fetch('/api/agent/tools')`；fallback 到 `PALETTE_TOOLS`（来自 `agent/tool-palette.tsx`）
- Produces: `{ tools: PaletteTool[]; isLoading: boolean; error: Error | null }`

- [ ] **Step 1: Write the failing test for success path**

```tsx
// tests/agent/use-agent-tools.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentTools } from '@/agent/use-agent-tools';

const REMOTE = [
  { name: 'foo', description: 'd', category: 'planning', requires_approval: false },
  { name: 'bar', description: 'd', category: 'llm', requires_approval: true },
];

describe('useAgentTools', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => REMOTE,
    } as any);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns remote tools on success', async () => {
    const { result } = renderHook(() => useAgentTools());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tools).toHaveLength(2);
    expect(result.current.tools[0].name).toBe('foo');
    expect(result.current.error).toBeNull();
  });

  it('falls back to hardcoded palette on fetch failure', async () => {
    (globalThis.fetch as any).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useAgentTools());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tools.length).toBeGreaterThanOrEqual(18);
    expect(result.current.error).not.toBeNull();
  });

  it('isLoading starts true then turns false', async () => {
    const { result } = renderHook(() => useAgentTools());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/use-agent-tools.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useAgentTools**

```ts
// agent/use-agent-tools.ts
import { useEffect, useState } from 'react';
import { PALETTE_TOOLS, type PaletteTool } from './tool-palette';

export interface UseAgentToolsResult {
  tools: PaletteTool[];
  isLoading: boolean;
  error: Error | null;
}

export function useAgentTools(): UseAgentToolsResult {
  const [tools, setTools] = useState<PaletteTool[]>(PALETTE_TOOLS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent/tools');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          setTools(data.map((d: any) => ({
            name: d.name,
            description: d.description ?? '',
            category: d.category,
            requiresApproval: !!d.requires_approval,
          })));
        }
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        // fallback to hardcoded
        setError(e);
        // eslint-disable-next-line no-console
        console.warn('useAgentTools: falling back to hardcoded palette', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { tools, isLoading, error };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/use-agent-tools.test.tsx`
Expected: 3 passed

- [ ] **Step 5: Run all frontend tests**

Run: `npm test`
Expected: 56 passed (was 53, +3 new tests)

- [ ] **Step 6: Commit**

```bash
git add agent/use-agent-tools.ts tests/agent/use-agent-tools.test.tsx
git commit -m "feat(agent): useAgentTools hook with remote + hardcoded fallback"
```

---

## Task 5: 前端 — `apiClient.listAgentTools()` + `listAgentTasks(projectId)`

**Files:**
- Modify: `services/apiClient.ts`（+`listAgentTools()`、+`listAgentTasks()`）
- Test: `tests/services/api-client-agent.test.ts`

**Interfaces:**
- Consumes: 同 Task 2/3 的后端端点
- Produces: `listAgentTools(): Promise<ToolMetadataOut[]>`；`listAgentTasks(projectId?: string): Promise<AgentTaskOut[]>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/services/api-client-agent.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient } from '@/services/apiClient';

describe('apiClient agent methods', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listAgentTools returns array from /api/agent/tools', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ name: 'a', description: 'd', category: 'planning', requires_approval: false }],
    });
    const r = await apiClient.listAgentTools();
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('a');
  });

  it('listAgentTasks with projectId calls query string', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    await apiClient.listAgentTasks('p-123');
    const called = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(called).toContain('/api/agent/tasks');
    expect(called).toContain('project_id=p-123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/services/api-client-agent.test.ts`
Expected: FAIL — listAgentTools is not a function

- [ ] **Step 3: Implement apiClient methods**

修改 `services/apiClient.ts`，在已有 `startAgent` 之后增加：

```ts
listAgentTools: () => request<{
  name: string; description: string; category: string; requires_approval: boolean;
}[]>('/agent/tools'),

listAgentTasks: (projectId?: string) => {
  const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return request<AgentTaskOut[]>(`/agent/tasks${q}`);
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/services/api-client-agent.test.ts`
Expected: 2 passed

- [ ] **Step 5: Run all frontend tests**

Run: `npm test`
Expected: 58 passed (was 56, +2 new tests)

- [ ] **Step 6: Commit**

```bash
git add services/apiClient.ts tests/services/api-client-agent.test.ts
git commit -m "feat(api-client): add listAgentTools and listAgentTasks"
```

---

## Task 6: 前端 — `useAgentStream` 加指数退避 + 切换 taskId close 旧 stream

**Files:**
- Modify: `agent/use-agent-stream.ts`（加重试逻辑 + abort/close on taskId change）
- Test: `tests/agent/use-agent-stream.test.ts`（追加新 case）

**Interfaces:**
- Consumes: `options.backoffMs = 1000`, `options.maxBackoffMs = 30000`
- Produces: 4 次重试失败后 `state='error'`，并停止重试

- [ ] **Step 1: Write the failing test for backoff sequence**

修改 `tests/agent/use-agent-stream.test.ts`，在文件末尾追加：

```ts
import { vi } from 'vitest';

describe('useAgentStream backoff', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    useAgentStore.getState().reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries connection on error with exponential backoff', async () => {
    useAgentStore.getState().setTask('t-1', 'running');
    renderHook(() => useAgentStream('t-1', { backoffMs: 100, maxBackoffMs: 800 }));
    expect(MockEventSource.instances).toHaveLength(1);
    // 第 1 次失败
    act(() => { MockEventSource.instances[0].fail(); });
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2);
  });

  it('stops retrying after 4 attempts and sets state to error', async () => {
    useAgentStore.getState().setTask('t-1', 'running');
    const { result } = renderHook(() => useAgentStream('t-1', { backoffMs: 10, maxBackoffMs: 40 }));
    for (let i = 0; i < 4; i++) {
      const es = MockEventSource.instances[MockEventSource.instances.length - 1];
      act(() => { es.fail(); });
      await act(async () => { vi.advanceTimersByTime(100); });
    }
    expect(result.current.state).toBe('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/use-agent-stream.test.ts`
Expected: FAIL — 没有 backoff 重试

- [ ] **Step 3: Implement backoff + retry**

修改 `agent/use-agent-stream.ts`，增加 options 参数和重试逻辑：

```ts
export interface UseAgentStreamOptions {
  backoffMs?: number;     // default 1000
  maxBackoffMs?: number;  // default 30000
  maxRetries?: number;    // default 4
}
```

实现：保留现有 `useEffect` 主体；on error 时启动 setTimeout 重试，delay 按 `min(backoffMs * 2^attempt, maxBackoffMs)` 增长，attempt < maxRetries 时继续，否则 state='error'。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/use-agent-stream.test.ts`
Expected: 全部 12 passed (was 10, +2 new tests)

- [ ] **Step 5: Run all frontend tests**

Run: `npm test`
Expected: 60 passed (was 58, +2 new tests)

- [ ] **Step 6: Commit**

```bash
git add agent/use-agent-stream.ts tests/agent/use-agent-stream.test.ts
git commit -m "feat(stream): exponential backoff with retry cap"
```

---

## Task 7: 前端 — `TaskList` 组件

**Files:**
- Create: `agent/task-list.tsx`
- Test: `tests/agent/task-list.test.tsx`

**Interfaces:**
- Consumes: `apiClient.listAgentTasks(projectId)`，调用 `onSelect(taskId)` callback
- Produces: 渲染任务列表，状态着色（idle/running/done/failed），点击触发 onSelect

- [ ] **Step 1: Write the failing test**

```tsx
// tests/agent/task-list.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskList } from '@/agent/task-list';
import { apiClient } from '@/services/apiClient';

describe('<TaskList />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when no tasks', async () => {
    vi.spyOn(apiClient, 'listAgentTasks').mockResolvedValue([]);
    render(<TaskList projectId="p1" onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('task-list-empty')).toBeInTheDocument());
  });

  it('renders task rows with status badges', async () => {
    vi.spyOn(apiClient, 'listAgentTasks').mockResolvedValue([
      { id: 't-1', user_goal: 'g1', status: 'running' },
      { id: 't-2', user_goal: 'g2', status: 'done' },
    ] as any);
    render(<TaskList projectId="p1" onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('task-list-row-t-1')).toBeInTheDocument());
    expect(screen.getByTestId('task-list-row-t-2')).toBeInTheDocument();
    expect(screen.getByTestId('task-list-status-running')).toBeInTheDocument();
    expect(screen.getByTestId('task-list-status-done')).toBeInTheDocument();
  });

  it('clicking a row calls onSelect with task id', async () => {
    const onSelect = vi.fn();
    vi.spyOn(apiClient, 'listAgentTasks').mockResolvedValue([
      { id: 't-1', user_goal: 'g1', status: 'running' },
    ] as any);
    render(<TaskList projectId="p1" onSelect={onSelect} />);
    await waitFor(() => screen.getByTestId('task-list-row-t-1'));
    fireEvent.click(screen.getByTestId('task-list-row-t-1'));
    expect(onSelect).toHaveBeenCalledWith('t-1');
  });

  it('refreshes on refresh button click', async () => {
    const spy = vi.spyOn(apiClient, 'listAgentTasks').mockResolvedValue([]);
    render(<TaskList projectId="p1" onSelect={() => {}} />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('task-list-refresh'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/task-list.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TaskList**

```tsx
// agent/task-list.tsx
import React, { useEffect, useState } from 'react';
import { apiClient, type AgentTaskOut } from '@/services/apiClient';

const STATUS_COLORS: Record<string, string> = {
  idle: '#94a3b8', pending: '#f59e0b', running: '#2563eb',
  paused: '#a855f7', done: '#10b981', failed: '#ef4444',
};

export interface TaskListProps {
  projectId: string;
  onSelect: (taskId: string) => void;
}

export const TaskList: React.FC<TaskListProps> = ({ projectId, onSelect }) => {
  const [tasks, setTasks] = useState<AgentTaskOut[] | null>(null);

  const load = async () => {
    const data = await apiClient.listAgentTasks(projectId);
    setTasks(data);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  if (tasks === null) {
    return <div data-testid="task-list-loading">loading…</div>;
  }
  if (tasks.length === 0) {
    return (
      <div data-testid="task-list-empty">
        还没有任务
        <button data-testid="task-list-refresh" onClick={load}>刷新</button>
      </div>
    );
  }
  return (
    <div data-testid="task-list">
      <button data-testid="task-list-refresh" onClick={load}>刷新</button>
      {tasks.map((t) => (
        <div
          key={t.id}
          data-testid={`task-list-row-${t.id}`}
          onClick={() => onSelect(t.id)}
          style={{ padding: 6, borderBottom: '1px solid #e2e8f0', cursor: 'pointer' }}
        >
          <span data-testid={`task-list-status-${t.status}`}
                style={{ background: STATUS_COLORS[t.status] || '#94a3b8', color: 'white', padding: '1px 6px', borderRadius: 3, fontSize: 10, marginRight: 6 }}>
            {t.status}
          </span>
          {t.user_goal}
        </div>
      ))}
    </div>
  );
};

export default TaskList;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/task-list.test.tsx`
Expected: 4 passed

- [ ] **Step 5: Run all frontend tests**

Run: `npm test`
Expected: 64 passed (was 60, +4 new tests)

- [ ] **Step 6: Commit**

```bash
git add agent/task-list.tsx tests/agent/task-list.test.tsx
git commit -m "feat(agent): TaskList component for project tasks"
```

---

## Task 8: 前端 — `TaskGraphNode` 移除 @xyflow/react 依赖

**Files:**
- Modify: `agent/task-graph-node.tsx`（去掉 Handle/Position/NodeProps import）
- Modify: `tests/agent/task-graph-node.test.tsx`（去掉 ReactFlowProvider 包装）

- [ ] **Step 1: Update test to remove ReactFlowProvider**

修改 `tests/agent/task-graph-node.test.tsx`：
- 删除 `import { ReactFlowProvider } from '@xyflow/react'`
- 删除 `function wrap(...)` helper
- 在每个 `wrap(` 替换为 `render(`，并去掉 `</ReactFlowProvider>`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/task-graph-node.test.tsx`
Expected: FAIL — `Handle` 不存在

- [ ] **Step 3: Remove @xyflow/react imports from TaskGraphNode**

修改 `agent/task-graph-node.tsx`：
- 删除 `import { Handle, Position, type NodeProps } from '@xyflow/react'`
- 删除文件内 `<Handle type="target" position={Position.Left} ... />` 和 `<Handle type="source" position={Position.Right} ... />` 两行
- 删除 `type TaskGraphNodeProps extends Partial<NodeProps>` → 简化为 `interface TaskGraphNodeProps { data: TaskGraphNodeData }`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/task-graph-node.test.tsx`
Expected: 10 passed (与之前一致)

- [ ] **Step 5: Run all frontend tests**

Run: `npm test`
Expected: 64 passed (no change in count, just dependency cleanup)

- [ ] **Step 6: Commit**

```bash
git add agent/task-graph-node.tsx tests/agent/task-graph-node.test.tsx
git commit -m "refactor(task-graph-node): remove @xyflow/react dependency"
```

---

## Task 9: 前端 — `AgentMode` 页面组装

**Files:**
- Create: `agent/agent-mode.tsx`
- Test: `tests/agent/agent-mode.test.tsx`

**Interfaces:**
- Consumes: `useAgentStore`，`useAgentStream`，`useAgentTools`，`ThoughtStream`，`TaskList`，`ToolPalette`，`apiClient.startAgent`
- Produces: 顶级 React 组件，组合 input + 任务列表 + 工具面板 + thought stream

- [ ] **Step 1: Write the failing test**

```tsx
// tests/agent/agent-mode.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentMode } from '@/agent/agent-mode';
import { apiClient } from '@/services/apiClient';
import { useAgentStore } from '@/agent/use-agent-store';

describe('<AgentMode />', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('renders input bar with goal field and create button', () => {
    render(<AgentMode projectId="p1" />);
    expect(screen.getByTestId('agent-mode-input')).toBeInTheDocument();
    expect(screen.getByTestId('agent-mode-submit')).toBeInTheDocument();
  });

  it('renders TaskList component', () => {
    render(<AgentMode projectId="p1" />);
    expect(screen.getByTestId('task-list')).toBeInTheDocument();
  });

  it('renders ToolPalette with tools', async () => {
    vi.spyOn(apiClient, 'listAgentTools').mockResolvedValue([
      { name: 'a', description: 'd', category: 'planning', requires_approval: false },
    ] as any);
    render(<AgentMode projectId="p1" />);
    await waitFor(() => expect(screen.getByTestId('tool-palette')).toBeInTheDocument());
  });

  it('submitting goal calls startAgent and sets task in store', async () => {
    vi.spyOn(apiClient, 'startAgent').mockResolvedValue({ id: 't-1' } as any);
    vi.spyOn(apiClient, 'listAgentTasks').mockResolvedValue([]);
    render(<AgentMode projectId="p1" />);
    fireEvent.change(screen.getByTestId('agent-mode-input'), { target: { value: '做一个短片' } });
    fireEvent.click(screen.getByTestId('agent-mode-submit'));
    await waitFor(() => expect(apiClient.startAgent).toHaveBeenCalled());
    expect(useAgentStore.getState().taskId).toBe('t-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/agent-mode.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AgentMode**

```tsx
// agent/agent-mode.tsx
import React, { useState } from 'react';
import { useAgentStore } from './use-agent-store';
import { useAgentStream } from './use-agent-stream';
import { useAgentTools } from './use-agent-tools';
import { ThoughtStream } from './thought-stream';
import { ToolPalette } from './tool-palette';
import { TaskList } from './task-list';
import { apiClient } from '@/services/apiClient';

export interface AgentModeProps {
  projectId: string;
}

export const AgentMode: React.FC<AgentModeProps> = ({ projectId }) => {
  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskId = useAgentStore((s) => s.taskId);
  const setTask = useAgentStore((s) => s.setTask);
  const { tools, isLoading: toolsLoading } = useAgentTools();
  useAgentStream(taskId);

  const onSubmit = async () => {
    if (!goal.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const t = await apiClient.startAgent(projectId, goal.trim());
      setTask(t.id, 'running');
      setGoal('');
    } catch (e: any) {
      setError(e?.message || 'failed to start agent');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="agent-mode" style={{ display: 'grid', gridTemplateColumns: '300px 1fr 280px', height: '100vh' }}>
      <aside style={{ borderRight: '1px solid #e2e8f0', overflowY: 'auto' }}>
        <div style={{ padding: 8 }}>
          <h3>任务</h3>
          <TaskList projectId={projectId} onSelect={(id) => setTask(id, 'running')} />
        </div>
        <div style={{ borderTop: '1px solid #e2e8f0', padding: 8 }}>
          <h3>思考流</h3>
          <ThoughtStream />
        </div>
      </aside>
      <main style={{ padding: 16 }}>
        <div data-testid="agent-mode-input-bar" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            data-testid="agent-mode-input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="描述目标，例如：做一个 30 秒的雨夜短片"
            style={{ flex: 1, padding: 8 }}
          />
          <button
            data-testid="agent-mode-submit"
            onClick={onSubmit}
            disabled={submitting || !goal.trim()}
          >
            {submitting ? '创建中…' : '创建任务'}
          </button>
        </div>
        {error && <div data-testid="agent-mode-error" style={{ color: 'red' }}>{error}</div>}
        <div data-testid="agent-mode-canvas-placeholder" style={{ border: '1px dashed #cbd5e1', padding: 24, textAlign: 'center', color: '#64748b' }}>
          画布：后续接入 InfiniteCanvas
        </div>
      </main>
      <aside style={{ borderLeft: '1px solid #e2e8f0', overflowY: 'auto' }}>
        {toolsLoading ? <div>loading tools…</div> : <ToolPalette tools={tools} />}
      </aside>
    </div>
  );
};

export default AgentMode;
```

- [ ] **Step 4: Update ToolPalette to accept `tools` prop**

修改 `agent/tool-palette.tsx`：
- 函数签名改为 `export const ToolPalette: React.FC<{ tools?: PaletteTool[] }> = ({ tools }) => {`
- 内部用 `tools ?? PALETTE_TOOLS` 作为数据源

- [ ] **Step 5: Update existing ToolPalette tests**

修改 `tests/agent/tool-palette.test.tsx`：
- 把 `render(<ToolPalette />)` 改为 `render(<ToolPalette tools={PALETTE_TOOLS} />)`
- 在文件顶部加 `import { PALETTE_TOOLS } from '@/agent/tool-palette';`

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: 68 passed (was 64, +4 new tests in agent-mode)

- [ ] **Step 7: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -E "agent/|apiClient"`
Expected: empty

- [ ] **Step 8: Commit**

```bash
git add agent/agent-mode.tsx agent/tool-palette.tsx tests/agent/agent-mode.test.tsx tests/agent/tool-palette.test.tsx
git commit -m "feat(agent): AgentMode page composing input + TaskList + ThoughtStream + ToolPalette"
```

---

## 验收总结

完成后测试数预期：
- 后端：130 passed (was 123, +7 new)
- 前端：68 passed (was 53, +15 new)
- 合计：198 passed
- E2E：5 passed（无变化）

---

## 范围外（v1 不做）

- Plan 阶段强制用户审核 UI 流
- 旧 useTaskExecutor 与新 agent runtime 的兼容/切换开关
- 多用户协作
- WebSocket 替代 SSE
- 服务端 sandbox
- AgentMode 画布与现有 InfiniteCanvas 的具体集成（v1 用占位符，v1.1 接入）
