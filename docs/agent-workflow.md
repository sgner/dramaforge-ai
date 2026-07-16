# Agent 工作流与可见反馈

## Agent 状态

Agent 的思考、动作、观察、计划、提问、恢复和取消状态只进入 ThoughtStream/桌宠面板；画布只投影资产节点。

## 并行生成

当计划包含互相独立的图片或视频任务时，Agent 应调用 `generate_media_batch`。运行时先为全部 jobs 创建 pending 资产并发送事件，再并行调用 provider。某一 job 失败不会删除其他 job，也不会阻塞主流程。

## 恢复与取消

失败节点保留稳定 ID，重试更新同一行资产，不重复创建资产。恢复过程发送 started/progress/finished 事件，前端显示当前 job、提示词、模型和引用资产。用户主动停止后，运行时取消等待中的 provider/recovery 任务，并丢弃迟到结果。

## 开发检查

```bash
npm run build
npm test -- --run tests/agent tests/infinite-canvas
cd backend
uv run pytest -q
```

浏览器烟测至少确认首页可加载、进入新建项目流程无错误覆盖层、Agent 入口可响应；真实 provider 调用应使用项目 API 设置中的能力绑定，不应依赖开发机测试数据。

## 2026-07-16 交接记录：桌宠文本与角色设计图提示词

### 已完成

- 桌宠不再完整展示长文本：思考内容和流式内容分别限制为 140/180 个字符，最近媒体提示词限制为 180 个字符，并保留省略号，避免提示词撑满桌宠面板。
- 在根目录 `constants.ts` 增加 `CHARACTER_DESIGN_SHEET_PROMPT`，作为角色设计图的唯一版式约束：左侧三分之一为胸像特写，右侧三分之二为正面/侧面/背面全身图，使用 `F0EDE8` 背景，保持角色服装、发型、配饰和比例一致，并禁止文字、编号和标注。
- 前端 `services/mediaService.ts` 的角色生成路径接入该模板；后端 Agent 的 `generate_character_portrait` 也会将该模板加入 source prompt，并把它作为 `canonical_layout` 传入提示词优化器。
- 提示词优化器在收到 `canonical_layout` 时必须保留布局、视角、一致性、背景和负面约束，只能补充角色身份、动作、镜头、材质或灯光信息，不能用泛化描述替换模板。
- 上传角色标准化路径 `backend/app/agent/asset_intelligence.py` 同步使用相同的角色设计图结构，用于把单人物上传图转换为项目可复用的角色设计图。

### 关键文件

- `agent/agent-pet-controller.tsx`：桌宠文本截断与展示。
- `constants.ts`：角色设计图规范提示词。
- `services/mediaService.ts`：前端角色生成提示词组装。
- `backend/app/agent/tools/image_tools.py`：Agent 角色生图与 canonical layout 传递。
- `backend/app/agent/tools/llm_tools.py`：提示词优化器硬约束说明。
- `backend/app/agent/asset_intelligence.py`：上传角色标准化提示词。

### 验证结果

- `npm test -- --run tests/agent/agent-pet-controller.test.tsx tests/constants-character-prompt.test.ts`：8 项通过。
- `backend/.venv/Scripts/python.exe -m pytest tests/test_asset_intelligence_contract.py tests/test_agent_media_tools.py tests/test_agent_media_batch.py -q`：28 项通过。
- `npm run build`：构建通过，仅保留既有 chunk size warning。
- 后端 `http://127.0.0.1:8765/api/health`：HTTP 200。
- 浏览器烟测：首页可以加载，页面无运行时错误覆盖层；浏览器测试结束后已关闭临时测试标签。

### 后续注意

- provider 最终画风仍受具体生图模型能力影响；当前代码保证模板版式和一致性约束进入生成与优化链路，但不能保证不同 provider 对同一提示词产生完全相同的视觉结果。
- `services/mediaService.ts` 的后端代理路径已统一加入角色模板；旧的直连 provider 分支仍保留作兼容 fallback，后续若彻底移除旧链路，应同步删除对应的重复 prompt 组装逻辑。
- 修改角色设计图模板时，应同时更新 `constants.ts`、后端 Agent 模板和 `tests/constants-character-prompt.test.ts`，避免三条生成路径再次分叉。
