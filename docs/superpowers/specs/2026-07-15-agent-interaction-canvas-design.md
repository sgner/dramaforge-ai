# Agent 交互协议与画布事件一致性设计

## 背景

Agent 当前通过 `ask_user` 暂停并等待用户回答。后端已经允许 JSON 响应，但提问协议只有字符串数组 `options`，前端把每个选项直接提交为单个字符串，因此无法表达多选、确认、自由输入和组合回答。与此同时，AgentMode 向画布投影时传入了 plan、actions、observations 和 pendingQuestion，但 `addAgentNodes` 实际只创建资产分类节点，导致画布时间线与 agent 事件流不一致。

## 目标

1. 支持单选、多选、确认、自由文本和选择后补充文本。
2. 多选回答以 `response: string[]` 传输，补充内容以 `custom_text` 传输。
3. 保持旧版 `options: string[]` 和字符串 response 的兼容性。
4. 保证 request_user_input、hydrate、respond、resume、user_input_received 的结构化数据一致。
5. 将 goal、plan、action、observation、question、artifact、done 事件稳定投影到画布，重复回放只更新节点。
6. 修复响应卡的遮挡、选择反馈、提交状态和错误恢复。

## 方案

采用统一交互协议，保留现有 AgentEvent、Zustand store、画布 store 和资源节点体系。新增字段只在 ask_user payload 中出现：

```ts
type AskUserOption = { id: string; label: string };
type SelectionMode = 'single' | 'multiple' | 'confirm' | 'text';

interface PendingQuestion {
  question: string;
  options?: AskUserOption[];
  selection_mode?: SelectionMode;
  allow_custom?: boolean;
  min_selections?: number;
  max_selections?: number;
}

interface AgentUserResponse {
  response?: string | string[];
  custom_text?: string;
  approved?: boolean;
}
```

旧版 `options: string[]` 自动归一化为 `{id,label}`，默认 `selection_mode: 'single'`。没有 options 时默认 `text`。`confirm` 使用 `approved`，也可以携带 `custom_text`。后端不强制改写 response 类型，runtime 继续将完整响应注入 memory。

## 前端交互

响应卡按 selection_mode 渲染：single 点击后选中但不立即提交，multiple 使用复选状态并显示选择计数，confirm 显示确认/取消按钮，text 只显示输入框。`allow_custom` 时始终显示补充输入。提交前执行 min/max 校验；提交期间禁用控件；请求失败显示错误并恢复可操作状态。浮层使用独立的响应层级和响应式宽度，不遮挡 ThoughtStream 与画布主流程。

## 事件与画布投影

`useAgentStore.applyEvent` 保存完整 question payload；`hydrate` 对旧新 pending_response 做归一化。`addAgentNodes` 保留现有 artifact image/prompt 节点，同时为 agent timeline 建立稳定 id：`agent-timeline-{taskId}-{kind}-{eventKey}`。事件 key 优先使用 step/id/timestamp，重复 SSE replay 更新同一节点。question 节点显示等待状态与选项摘要，user_input_received 后更新为成功，task_done/task_failed 更新终态。clear、relayout、fit、drag override 和项目切换均按 `agent-` 前缀处理。

## 错误处理与兼容

- 空问题或非法 options 在前端降级为文本输入。
- 后端接收旧字符串、数组和对象 response，不破坏现有 recovery_action。
- SSE 重放和 hydrate 都必须避免已回答问题重新显示为 pending。
- 响应失败不清除本地选择，允许重试。

## 测试策略

- 前端 store：旧/新 question payload 归一化、结构化 response 事件清理。
- 响应卡：single、multiple、confirm、text、custom_text、校验、失败重试和单次提交。
- 后端：ask_user payload、respond 的数组/补充字段、resume 注入和事件 payload。
- 画布：timeline 节点创建/更新、重复事件幂等、question 状态变化、清理/重排。
- 集成：AgentMode 从事件到浮层与画布的完整流程。
- 运行验证：Vite 桌面窄屏截图、控制台错误、交互状态和节点操作。

## 非目标

本次不重构整个画布存储层、不删除现有资源节点、不改变工具执行语义，也不引入新的 UI 组件库。
