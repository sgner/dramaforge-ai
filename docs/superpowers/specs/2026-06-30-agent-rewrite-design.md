# DramaForge AI — Agent 改造设计 (Brainstorming 整合)

**日期**：2026-06-30
**状态**：等待用户审批
**关联文档**：[PRD.md](../../agent-rewrite/PRD.md) · [plan.md](../../agent-rewrite/plan.md) · [tech-design.md](../../agent-rewrite/tech-design.md)

---

## 1. 决策记录

| 决策点 | 选择 |
|---|---|
| 实施范围 | **完整 Agent 框架 + 全部 18 个工具** |
| Plan 阶段 | **必须经过用户审核**（防止 LLM 乱决策） |
| 高成本工具 | **需要用户确认**；**勾选"本任务不再提示"可免审**（粒度到任务级别） |
| 实施起点 | **从后端 Agent Runtime 开始**（先跑通后端再上 UI） |

## 2. 核心架构

```
┌──────────────────────────────────────────────────────────┐
│                    DramaForge Director Agent              │
│                                                          │
│  角色：短剧导演                                           │
│  目标：把小说/创意变成可拍脚本 + 视觉资产                  │
│  核心：ReAct 循环 + 18 个工具 + 持久化 + SSE 事件流        │
└──────────────────────────────────────────────────────────┘
                         ↓
    ┌────────────────────┴────────────────────┐
    ↓                                         ↓
[ 后端 FastAPI ]                       [ 前端 React ]
   AgentRuntime                           useAgentStore
   ToolRegistry (18)                      ThoughtStream
   EventBus → SSE                         TaskGraphNode
   AgentMemory                            ToolPalette
                                          PendingApprovalCard
```

## 3. ReAct 主循环 (后端)

```python
class AgentRuntime:
    async def run(self, user_goal: str):
        # Phase 1: 解析目标
        goal = await self.call_tool("parse_user_goal", {"user_goal": user_goal})
        self.emit("goal_parsed", goal)
        
        # Phase 2: 创建 Plan（必须用户审核）
        plan = await self.call_tool("create_plan", {"goal": goal})
        self.emit("plan_ready", plan)
        approval = await self.wait_for_user_approval("plan", plan)
        if not approval.approved:
            plan = await self.revise_plan(approval.feedback)
        
        # Phase 3: ReAct 循环执行
        for step in range(MAX_STEPS):
            thought = await self.think()           # LLM 思考
            self.emit("thought", thought)
            
            action = parse_action(thought)          # LLM 决定调哪个工具
            
            if action.tool == "ask_user":
                response = await self.wait_for_user_input(action.question)
                observation = response
            elif action.tool == "finish_task":
                break
            elif self.should_confirm(action):       # 高成本工具需确认
                if not self.task_level_skip_confirm:
                    confirm = await self.wait_for_user_approval("tool", action)
                    if not confirm.approved:
                        continue
            else:
                observation = await self.call_tool(action.tool, action.params)
            
            self.memory.add_step(thought, action, observation)
            self.emit("observation", observation)
        
        self.mark_done()
```

## 4. 18 个工具清单

| 类别 | 工具 | 需审核 |
|---|---|---|
| planning | `parse_user_goal` | ✗ |
| planning | `create_plan` | ✓ |
| planning | `ask_user` | ✓ (本身就是问) |
| llm | `generate_script` | ✗ |
| llm | `extract_characters` | ✗ |
| llm | `extract_props` | ✗ |
| llm | `extract_scenes` | ✗ |
| llm | `extract_shots` | ✗ |
| llm | `optimize_prompt` | ✗ |
| image | `generate_character_portrait` | ✓ |
| image | `generate_prop_image` | ✗ |
| image | `generate_scene_image` | ✓ |
| image | `generate_storyboard_image` | ✓ |
| video | `generate_video` | ✓ |
| audio | `generate_voiceover` | ✗ |
| audio | `generate_bgm` | ✗ |
| asset-mgmt | `save_asset` | ✗ |
| asset-mgmt | `upload_reference` | ✗ |

## 5. 用户免审机制

**勾选 + 本任务免审**：
- 每次高成本工具确认卡片有 checkbox: "本次任务不再提示"
- 勾选后该 task 的 `task_level_skip_confirm=true`
- 后续同类型工具直接执行
- 新任务重置

## 6. 实施顺序（后端先行）

| 周 | 工作 |
|---|---|
| W1 | Tool 基类 + Registry + EventBus + 3 个 planning 工具 + AgentTask/Step 模型 |
| W2 | LLMClient 抽象 + 7 个 LLM 工具（迁移旧 7 步） + 4 个图像工具 + 1 个视频工具 + 2 个音频工具 + 2 个资产工具 |
| W3 | AgentMemory + AgentRuntime ReAct 循环 + /api/agent 路由 (SSE) + legacy_executor.py 兼容 |
| W4 | E2E 测试（Plan → Script → 角色 → 场景 → 分镜 → 视频）+ 失败重试 + 备用模型 |

## 7. 关键设计取舍（与参考项目 sga_template 差异）

| 维度 | 参考项目 sga_template | DramaForge |
|---|---|---|
| 节点引擎 | 自实现 DAG 调度器 | **复用现有无限画布** |
| LLM 调用 | 直连 | **后端代理**（API Key 安全） |
| 持久化 | 弱（依赖 ComfyUI session） | **SQLite + AgentTask/Step 表** |
| 创意控制 | 用户拖节点 | **LLM 决策 + 用户审核** |
| 适用范围 | 通用工作流 | **专注视频创作**（18 个预置工具） |

## 8. 验收标准

- [ ] 后端启动后能跑通一个 demo 任务：输入目标 → Plan → Script → 1 个角色图 → 1 个分镜图
- [ ] 旧 7 步流程仍能用（legacy_executor.py）
- [ ] 任务中断后能从数据库恢复
- [ ] 失败工具能重试 1 次 + 换备用模型 1 次
- [ ] SSE 事件流稳定，前端能实时看到 thought

## 9. 风险

- **LLM 决策失控**：Plan 审核 + 工具白名单 + max_steps 兜底
- **成本失控**：高成本工具确认 + 任务级免审
- **旧 7 步破坏**：保留 legacy_executor.py，1 周内可切换
- **SSE 连接不稳定**：前端 EventSource 自动重连 + 缓存最近 100 个事件
