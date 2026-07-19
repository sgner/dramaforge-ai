# Agent 提问国际化设计

## 目标

Agent 在澄清创作来源和交付内容时，不向用户展示内部参数名，并且使用创建任务时的界面语言生成提问。当前支持 `zh`、`en`、`ja`、`ko`，未知语言统一回退到英文。

## 方案

- 前端创建 Agent 任务时传递当前 `lang`。
- 后端校验语言只接受 `zh`、`en`、`ja`、`ko`，并将其保存到任务配置中。
- AgentRuntime 从任务配置读取语言，在生成 `ask_user` 提问和相关用户可见文案时使用对应语言。
- 内部字段（例如 `structured_source`、`agreed_deliverables`）继续用于状态判断和持久化，但不直接拼接到面向用户的文本中。
- 已存在且没有语言配置的任务使用英文兜底；前端语言切换不改变运行中任务的语言。

## 数据流

`I18nProvider.lang` → `createAgentTask({ language })` → `AgentTask.task_profile.language` → `AgentRuntime` → `request_user_input.question`

## 测试

- API/运行时测试验证四种语言生成对应文案。
- 测试未知语言和旧任务时回退英文。
- 测试确保内部参数名不出现在任何用户提问中。
- 前端测试验证创建任务请求携带当前语言。
