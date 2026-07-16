# Agent 第二阶段及后续演进规划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute each work package with tests and independent review.

**Goal:** 将第一阶段建立的 Agent、资产图谱、提示词工程和恢复框架，推进为可稳定执行真实创作任务的多领域生产系统。

**Architecture:** 继续保持“Agent 状态只存在 ThoughtStream、画布只承载资产节点”的边界。任务以 project/task 为隔离单位，所有生成以结构化来源、规则包、提示词优化和资产引用为前置；长流程拆成可恢复的工作单元，媒体失败只影响子任务，不重放主流程。

**Tech Stack:** FastAPI、SQLAlchemy、SQLite/Postgres 兼容模型、React、Zustand、Vitest、Pytest、SSE/事件流、现有 API provider/model capability binding。

## 第一阶段基线

第一阶段已完成：

- 多领域任务画像和版本化规则包；
- 任务画像、用户问题、计划状态持久化与刷新恢复；
- 资产来源、派生、版本、角色、生命周期状态；
- 上传资产检查、标准化资产派生、引用解析；
- 生图、生视频、分镜和批量媒体的提示词优化入口；
- Agent 与画布共存、ThoughtStream 状态展示、桌宠交互；
- 旧资产智能合约兼容和基础恢复路径。

第一阶段尚未等同于生产完成：真实 provider 失败恢复、跨镜头一致性、子任务隔离、端到端性能和部署数据库迁移仍需要继续验证。

## 全局约束

- Agent 思考、动作、计划、问题和恢复过程不得生成画布节点。
- 画布只显示用户资产、生成资产、上传资产和可连接的工作节点。
- 所有用户问题同时支持预设选项和自由输入；提交结果必须持久化并能在刷新后恢复。
- 所有图片、视频和分镜生成必须经过规则包和提示词优化；优化返回空值时禁止调用 provider。
- 上传源资产不可变；标准化、裁切、重试都产生可追踪的派生版本或更新同一逻辑资产。
- 所有状态和事件必须带 project_id/task_id；切换项目不能泄漏其他项目的 Agent 状态或资产。
- 不允许使用硬编码演示数据、固定测试动作或无来源的默认恢复流程。
- 变更必须有自动化测试；任何阶段完成前必须通过后端、前端和关键浏览器 E2E 验证。

---

## 阶段 2：可靠性与数据一致性（最高优先级）

**目标：** 先消除“突然失败、疯狂重试、提问后丢失、连接无限重连、刷新数据不一致”等基础问题。

### 2.1 任务状态机收敛

**范围：** `backend/app/models.py`、`backend/app/routers/agent.py`、`backend/app/agent/runtime.py`、`agent/use-agent-store.ts`、`agent/task-list.tsx`。

**工作：**

- 明确定义 `pending/running/paused/waiting_user/recovering/done/failed/stopped` 的合法转换；
- stop、retry、resume 使用幂等 request key，重复点击不能创建第二条执行链；
- 用户回答绑定到具体 `pending_question_id`，不能被旧问题或其他任务消费；
- 任务终态停止 SSE 重连和心跳；
- reconnect 只从服务端快照恢复，不使用前端旧内存状态覆盖服务端数据。

**验收：** 连续点击创建、停止、重试、回答各 10 次，任务数和动作数保持可解释；刷新、断线重连、切换项目后状态一致。

### 2.2 事件流可靠性

**范围：** `agent/agent-stream-manager.ts`、`backend/app/agent/events.py`、`backend/app/routers/agent.py`。

**工作：**

- 使用事件 ID、游标和去重集合恢复 SSE；
- 对 connection error、heartbeat timeout、HTTP 400/404 分类处理；
- 限制重连退避和次数，终止状态不再重连；
- 空思考、重复事件、旧项目事件不进入 ThoughtStream。

**验收：** 模拟网络断开、服务重启、重复事件、乱序事件，最终 ThoughtStream 和计数不重复、不空白、不跨项目。

### 2.3 数据库迁移与持久化

**范围：** `backend/app/database.py`、`backend/app/models.py`、`backend/app/schemas.py`、迁移脚本目录。

**工作：**

- 将第一阶段新增字段从启动时 backfill 收敛为显式迁移；
- 为 task profile、pending question、asset provenance、recovery child job 建立索引；
- 验证 SQLite 和生产 Postgres 的字段类型、JSON 字段和默认值一致。

**验收：** 空数据库、旧数据库、已有任务数据库都能启动并完成迁移；迁移可重复执行且不丢资产。

### 2.4 阶段 2 闸门

- 后端关键任务/事件测试全通过；
- 浏览器 E2E 覆盖创建任务、Agent 提问、自由输入、回答后继续、停止、重试、刷新恢复；
- 控制台不再出现无限 `connection error, retrying`；
- 服务重启后健康检查和已有任务恢复正常。

---

## 阶段 3：资产生产闭环与一致性

**目标：** 让 Agent 真正理解“已有资产、标准资产、参考资产和派生资产”，并在后续镜头中稳定复用。

### 3.1 上传资产多模态判定

**范围：** `backend/app/agent/asset_intelligence.py`、`backend/app/agent/tools/asset_intelligence_tools.py`、`components/infinite-canvas/CanvasAssetPanel.tsx`。

**工作：**

- 判断上传内容是角色、道具、场景、产品、素材还是文档；
- 识别是否符合角色设计图、道具参考图、场景参考图标准；
- 给出“直接使用/需要标准化/信息不足”的结构化结论；
- 为用户显示来源、派生关系、标准化状态和失败原因。

### 3.2 资产版本与引用策略

**范围：** `backend/app/agent/asset_references.py`、`backend/app/agent/media_assets.py`、`backend/app/agent/tools/asset_tools.py`。

**工作：**

- 同一逻辑资产的重试更新版本，不追加重复资产；
- 对角色、道具、场景、分镜、视频建立角色化引用策略；
- 生成分镜时按场景、角色、道具自动解析参考图；
- 生成视频时继承对应分镜、角色和道具引用，并记录连续性快照。

### 3.3 常量与提示词工程治理

**范围：** `constants.ts`、`backend/app/agent/rule_packs.py`、`backend/app/agent/prompt_engineering.py`、`backend/app/agent/tools/image_tools.py`、`backend/app/agent/tools/video_tools.py`。

**工作：**

- 将角色设计图标准提示词正式纳入版本化规则包；
- 区分“语义描述”和“生成 Prompt”；
- 统一负面约束、画风、比例、参考图和镜头连续性；
- 在 ThoughtStream 中展示“原始描述 → 优化提示词 → 参考资产”。

### 3.4 阶段 3 闸门

- 上传单人物图片能生成标准角色设计图，并保留源图；
- 一个道具能被多个角色和多个分镜引用；
- 分镜图能同时携带场景、角色、道具参考；
- 失败重试不会产生重复资产；
- 相同角色跨至少 3 个分镜的引用和提示词保持一致。

---

## 阶段 4：多领域创作工作流

**目标：** 从短剧扩展为纪录片、宣传片、电商广告和自定义视频，而不是把所有任务都套用短剧流程。

### 4.1 意图识别与任务画像

**范围：** `backend/app/agent/task_profiles.py`、`backend/app/agent/rule_packs.py`、`backend/app/agent/tools/planning.py`、`backend/app/agent/runtime.py`。

**工作：**

- 识别短剧、纪录片、宣传片、电商广告、自定义任务；
- 记录置信度和触发依据；
- 对模糊输入先询问任务类型或给出可修改的默认画像；
- 规则包按领域注入来源要求、镜头结构、资产类别和输出目标。

### 4.2 来源优先的领域流程

**短剧：** 目标 → 解构脚本 → 角色/道具/场景/镜头 → 提示词 → 媒体生成。

**纪录片：** 主题/资料/采访素材 → 事实结构 → 旁白与镜头 → 素材引用 → 剪辑计划。

**宣传片：** 品牌目标/受众/卖点 → 信息层级 → 场景与镜头 → 品牌一致性 → 视频/配音。

**电商广告：** 商品资料/图片 → 卖点与合规约束 → 商品参考图 → 镜头脚本 → 视频/字幕/CTA。

**自定义：** 先生成可审核的工作流草案，再允许用户编辑步骤、来源和输出。

### 4.3 阶段 4 闸门

- 五类任务都能生成不同的可审核计划；
- 缺少关键来源时先提问或创建明确的来源待办，不直接生成空提示词；
- 同一 Agent 工具可被不同领域复用，但规则包不会串领域；
- 每种领域至少有一个浏览器 E2E 场景。

---

## 阶段 5：并行执行与子任务恢复

**目标：** 让多图片、多视频、多角色生成真正并行，并让失败处理成为独立、可观察、可汇总的子任务。

### 5.1 可持久化工作单元

**范围：** 新建 `backend/app/agent/recovery_jobs.py`，修改 `backend/app/models.py`、`backend/app/agent/runtime.py`、`backend/app/routers/agent.py`。

**接口：**

```python
create_recovery_job(parent_task_id: str, failed_action_id: str, context: dict) -> RecoveryJob
retry_recovery_job(job_id: str, strategy: str) -> RecoveryJob
summarize_recovery_job(job_id: str) -> dict
```

**要求：** 子任务拥有独立状态、重试次数、失败原因、原始提示词、优化提示词、参考资产和结果资产 ID；完成后只向主任务提交摘要事件。

### 5.2 批量生成调度

**范围：** `backend/app/agent/tools/media_batch.py`、`backend/app/agent/media_assets.py`、前端 ThoughtStream。

**工作：**

- 使用有界并发，不创建无上限 Promise；
- 每个 job index 立即显示 queued/running/succeeded/failed；
- 一个失败不阻塞其他 job；
- 重新执行只选中失败 job，成功 job 复用已有资产。

### 5.3 阶段 5 闸门

- 10 个媒体任务能并行执行并显示逐项状态；
- 失败任务可以召唤恢复子任务，不增加主任务动作风暴；
- 停止后所有主任务、批任务和恢复任务都停止；
- 恢复完成后主流程只继续一次，不重复执行已完成步骤。

---

## 阶段 6：前端体验、性能与可观测性

**目标：** 解决大批量资产、长 ThoughtStream 和缩放画布下的卡顿与不可见问题。

### 6.1 ThoughtStream 性能

- 按事件类型分层渲染，默认只渲染最新摘要和用户关注的完整记录；
- 历史记录分页/虚拟列表；
- 长文本默认截断，点击展开完整内容；
- 事件计数来自服务端快照，避免每个 token 触发全界面重渲染。

### 6.2 画布性能与层级

- 资产节点使用稳定 key、视口裁剪和缩放下的最小可见尺寸；
- 桌宠、提问浮窗、ThoughtStream、API 弹窗使用明确的 z-index 层级契约；
- 桌宠位置按 viewport 保存并限制在可视边界内；
- Agent 退出/进入不销毁项目资产节点，不跨项目复用浮层状态。

### 6.3 可观测性

- 记录 provider、model、请求耗时、错误分类、任务/子任务 ID；
- 统计提示词优化空值、401/404/429/5xx、SSE 重连、重复 action；
- ThoughtStream 提供“本次任务诊断”摘要，而不是暴露全部内部日志。

### 6.4 阶段 6 闸门

- 100+ 资产和 500+ ThoughtStream 事件下页面可交互；
- 缩放到最小视图仍能看到资产节点；
- 浏览器控制台无无限重连、无大量 404、无固定测试数据；
- 关键操作有可定位到 task/action/provider 的诊断信息。

---

## 阶段 7：生产化与发布

**目标：** 让系统可以被真实用户持续使用和升级。

- Postgres 迁移、备份和恢复演练；
- provider capability binding 的加密存储、密钥遮蔽和验证诊断；
- 任务取消、数据删除、资产删除和派生关系的生命周期策略；
- 权限与项目隔离审计；
- README、交接文档、故障排查手册和 E2E 测试说明同步更新；
- CI 执行后端测试、前端测试、类型检查、构建和关键浏览器 E2E；
- 发布前建立最小真实 provider 测试矩阵，禁止用固定 demo 响应代替 provider 测试。

## 建议执行顺序

1. 阶段 2：可靠性与数据一致性；
2. 阶段 3：资产生产闭环；
3. 阶段 5：并行与恢复；
4. 阶段 4：多领域工作流；
5. 阶段 6：性能与体验；
6. 阶段 7：生产化发布。

顺序上先稳定执行引擎和资产底座，再扩展领域数量；否则每增加一种领域都会放大现有的提问恢复、重复动作、provider 错误和跨项目状态问题。

## 近期下一迭代建议

下一次开发只做阶段 2，不同时扩展新的领域。优先闭环以下用户路径：

```text
创建任务 → Agent 提问 → 自由输入回答 → 继续执行 → 媒体生成失败
→ 独立恢复 → 用户重试/停止 → 刷新页面 → 状态与资产不重复
```

这个闭环稳定后，再进入角色/道具/场景一致性和多领域流程扩展。
