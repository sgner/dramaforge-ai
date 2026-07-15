# Embedded Agent Canvas Design

## Goal

让 Agent 模式直接运行在现有画布中，不再创建第二个画布或替换当前画布页面；用户点击画布工具栏的 Agent 按钮后，按钮保持选中状态，并显示 Agent 前端组件。

## Current Problem

`App.tsx` 在 `agentMode` 为真时渲染完整的 `AgentMode` 页面，而普通画布分支被卸载。`agent/agent-mode.tsx` 又内部创建一个 `InfiniteCanvas`，造成画布实例切换、布局跳变和节点上下文不稳定。

## Design

### Single canvas ownership

`App` 始终渲染唯一的 `InfiniteCanvas`。Agent 模式不再替换主内容，也不再在 `AgentMode` 内创建 `InfiniteCanvas`。Agent 组件接收 `embedded`/overlay 语义，只渲染 UI 层与状态订阅。

### Layout

- 画布占据主区域的全部空间。
- 原有 `CanvasToolbar` 保持在顶部；`agentModeActive` 控制 Agent 按钮高亮。
- Agent 开启时显示顶部或顶部下方的目标输入浮层，不覆盖原有工具栏。
- 左侧显示可收起的 Agent 任务列表；收起时只保留窄条入口。
- 右侧显示可收起的 ThoughtStream；默认按照当前 Agent 任务状态打开或保持用户上次状态。
- 提问卡、错误恢复卡、工具抽屉均使用画布内浮层定位，点击浮层内容不会触发画布拖拽。
- Agent 资产继续通过 `useCanvasStore.addAgentNodes` 写入普通资产节点；Agent 思考、动作、观察、计划不创建画布节点。

### Interaction

- 点击 Agent：设置 Agent active，保留当前任务和画布 viewport，不创建新任务，除非当前没有任务。
- 点击 Agent 按钮再次进入时，只显示/隐藏 Agent 叠加层，不重置画布节点。
- 退出 Agent：只隐藏 Agent 叠加层，后台任务继续由全局 SSE 管理器运行；画布和资产节点保持原状。
- 从任务列表切换任务：使用现有 `setTask`/hydrate 流程，并让同一画布加载对应项目数据。
- Agent API 设置继续打开统一的画布 API 设置弹窗。

### Component boundaries

- `App.tsx`: 统一持有画布实例、Agent active 状态和浮层挂载位置。
- `InfiniteCanvas.tsx`: 继续负责画布及工具栏；不持有 Agent 思考状态。
- `agent/agent-mode.tsx`: 改成 Agent overlay coordinator，负责 Agent 输入、任务列表和浮层组件，不渲染画布。
- `agent/agent.css`: 增加嵌入式布局层级、左右抽屉、响应式折叠规则和浮层 pointer-events 规则。
- `useAgentStore`/`agent-stream-manager`: 保持全局任务流，不因 overlay 挂载/卸载重复连接。

## Error and lifecycle rules

- Agent overlay 卸载不能清除 `useAgentStore.taskId`，也不能清除资产节点。
- Agent 状态失败、暂停和等待用户时必须在 ThoughtStream/提问卡显示，不得回退到测试数据。
- 停止 Agent 后，SSE 和 runtime 停止；再次进入只读取持久化任务状态，不重复启动动作。
- 任何浮层关闭只改变 UI 展开状态，不改变任务状态。

## Validation

- React 测试：唯一 `InfiniteCanvas` 实例、Agent 按钮 active 状态、进入/退出不卸载画布、浮层显示与关闭、任务列表切换。
- 浏览器 E2E：画布模式 → 点击 Agent → 验证按钮高亮与 Agent 组件出现 → 创建/选择任务 → 退出 → 节点和 viewport 保持 → 再进入 → ThoughtStream 状态保持。
- 回归：完整前端测试、生产构建和浏览器控制台检查。

