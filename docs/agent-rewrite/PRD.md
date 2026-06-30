# DramaForge AI — Agent 化重构 PRD

> **版本**：v1.0
> **日期**：2026-06-30
> **作者**：DramaForge 产品团队
> **状态**：待评审

---

## 1. 背景与动机

### 1.1 现状

DramaForge AI 当前是一个**固定流程的工作流产品**：

```
小说原文 → 预处理 → 脚本生成 → 角色设计 → 道具设计 → 场景设计 → 分镜设计 → 提示词优化
```

`useTaskExecutor.ts` 用 `switch (TaskStatus.XXX)` 串联 7 个步骤，每步强依赖前一步的输出。用户能做的"控制"非常有限：开始 / 暂停 / 重做某一步 / 重试。

### 1.2 痛点

| 痛点 | 用户场景 |
|---|---|
| **流程僵硬** | 写一段对话需要先做完角色设计、再做道具、再做场景，做完一遍后才能改一处对话；改完后所有下游又得重跑 |
| **不可见** | 用户只能看到一个进度条和最终结果，不知道 LLM 此刻在做什么、为什么做这个决定 |
| **不可介入** | agent 走了 5 分钟后生成一张用户不满意的图，用户只能"取消"再"重来" |
| **不可分支** | 同一个场景想试 3 种不同的镜头语言，只能复制多个项目并修改 |
| **资产孤立** | 上传的图只能作为某个分镜的输入，没法成为后续所有分镜的参考 |

### 1.3 机会

参考 `C:\Users\25315\comfyui\...\comfy_workflow_agent\sga_template` agent 项目（基于 LLM 工具调用 / ReAct 模式自主决策），我们意识到 **LLM 完全可以作为"代驾"** —— 让它自主决定下一步做什么、调用什么工具、产出什么资产。这样：

- 创作流程变成一个**对话式 + 视图驱动**的过程
- 用户保留"上帝视角"：看 agent 在哪一步、调了哪个工具、为什么这样调
- 用户可以**随时介入**：要求 agent 改主意、替换工具、跳过某些步骤
- 同一个项目可分支：A/B 测试不同脚本、不同镜头风格

### 1.4 目标

把 DramaForge AI 从**"固定工作流"**改造为**"视频创作 Agent（Video Director Agent）"**：

- 核心交互模式：从"按下按钮等结果"变成"和 AI 一起工作"
- 核心展示方式：保留无限画布，但画布内容从"人工布置的节点图"变成"agent 实时执行的进度视图"
- 核心可控性：用户能观察、暂停、介入、接管、回滚

---

## 2. 产品定位

### 2.1 一句话定位

> **DramaForge Director Agent** —— 一个能和你协作完成短剧/短视频创作的 AI 代驾，你看着它工作，随时能插手。

### 2.2 目标用户

| 用户画像 | 痛点 | 价值主张 |
|---|---|---|
| **短剧编剧** | 自己写完小说后需要拆解成可视化脚本 | 让 agent 拆，自己审核和修改 |
| **短视频创作者** | 有创意但缺乏分镜能力 | 把创意给 agent，看它怎么实现，自己调整方向 |
| **广告/营销团队** | 需要快速产出多版本素材试水 | 让 agent 一次产出 3-5 个分支，自己选最好的 |
| **AI 视频学习者** | 不知道 prompt 怎么写效果才好 | 看 agent 怎么拆解场景、怎么拼 prompt，跟着学 |

### 2.3 非目标（明确不做）

- **不做通用 AI Agent 平台**（不做 workflow 自定义编辑器）
- **不做实时多人协作**（v1.0 单人项目）
- **不做移动端 App**（v1.0 仅 Web 桌面）
- **不替代剪映/PR**（仅产出素材，不做剪辑）

---

## 3. 核心概念

### 3.1 Agent（智能体）

```
┌─────────────────────────────────────────┐
│  Video Director Agent                    │
│                                          │
│  角色：短剧导演                           │
│  目标：把小说 / 创意变成可拍脚本 + 视觉资产  │
│  可用工具：18 个 (见 §6)                  │
│  自主决策：是 (ReAct + Planner)           │
│  可被打断：是                             │
│  可被接管：是                             │
└─────────────────────────────────────────┘
```

Agent 由**3 部分**组成：
1. **System Prompt**（导演人设 + 工作方法论）
2. **Tool Registry**（可用工具列表 + 调用 schema）
3. **Memory**（短期任务上下文 + 长期用户偏好 + 历史项目）

### 3.2 任务（Task）

一个 Task = 一次完整的创作会话：

```
Task {
  id: string
  userGoal: string              // 用户原话："帮我把这段小说变成 1 分钟短剧"
  status: 'pending' | 'running' | 'paused' | 'interrupted' | 'done' | 'failed'
  context: {
    rawNovelText?: string
    style?: string
    language?: 'zh' | 'en' | 'ja' | 'ko'
    targetDuration: number      // 单位：秒
    referenceImages?: AssetRef[]
  }
  history: AgentStep[]          // agent 决策历史
  artifacts: {                  // 已生成资产
    characters: Prop[]
    props: Prop[]
    scenes: SceneAsset[]
    shots: BigShot[]
    storyboards: GeneratedImage[]
  }
}
```

### 3.3 AgentStep（执行步骤）

```
AgentStep {
  id: string
  stepNumber: number
  thought: string              // agent 内心独白（"我决定先做角色设计，因为..."）
  action: ToolCall             // 决定调用哪个工具
  observation: ToolResult      // 工具返回结果
  status: 'pending' | 'running' | 'success' | 'failed' | 'user-overridden'
  durationMs: number
  startedAt: timestamp
  finishedAt?: timestamp
}
```

### 3.4 工具（Tool）

Tool 是 agent 能调用的原子能力，类型化、有参数 schema：

```typescript
type Tool = {
  name: string;                  // 'generate_script'
  description: string;           // agent 看到的工具说明
  category: 'llm' | 'image' | 'video' | 'audio' | 'asset-mgmt' | 'planning';
  parameters: JSONSchema;
  requiresApproval: boolean;     // 用户是否需要先点头
  estimatedCost?: number;        // 预估 token / 秒 / 元
  estimatedTime?: number;        // 预估耗时（秒）
};
```

### 3.5 任务图（Task Graph）

无限画布上展示的内容 = **任务图**，节点不再是"用户拖出来的节点"，而是 **agent 自动生成的工作项**：

```
节点类型:
  - Goal 节点      (任务的根，用户原话)
  - Decision 节点  (agent 决策点："我先做 X，因为 Y")
  - Action 节点    (工具调用：generate_script / generate_image / ...)
  - Artifact 节点  (产出物：角色图、场景图、分镜图、视频)
  - Branch 节点    (分支决策：用户说"再试一版"时产生)
  - User 节点      (用户介入点：改 prompt、选模型、确认方向)
```

---

## 4. 关键用户故事

### US-1：首次使用 — 把小说变成脚本

> **作为**编剧
> **我想要**把一段 5000 字的小说粘进 DramaForge，让 agent 帮我拆脚本
> **以便于**我不用自己手动分镜

**验收标准**：
1. 用户粘入小说，点"开始"
2. 画布上生成 Goal 节点显示用户原话
3. 5 秒内出现第一个 Action 节点 `generate_script`，旁边有 thought 气泡："我先把这段拆成 3 个 sequence，每个 30 秒"
4. 用户可点击 Action 节点查看 thought 详情、token 消耗、模型
5. 完成后自动生成 Script 节点（可滚动查看完整 JSON）
6. 用户可点"继续"或"修改后继续"

### US-2：观察与中断

> **作为**短视频创作者
> **我想要**看到 agent 每一步在做什么
> **以便于**我了解它的思路，发现问题能及时打断

**验收标准**：
1. 画布左侧实时显示"Agent Thought Stream"：滚动文字流显示 agent 当前在想什么
2. 每个 Action 节点有 4 种状态色：pending（灰）→ running（蓝脉冲）→ success（绿）→ failed（红）
3. 用户可点任意 running 节点 → 弹出"停止 / 暂停 / 强制完成"菜单
4. "停止"后任务变 `paused`，agent 等待用户下一步指令
5. "继续"按钮可恢复

### US-3：手动介入 — 改 prompt

> **作为**导演
> **我想要**在生成某张分镜图前修改 prompt
> **以便于**第一次生成不满意时不用从零开始

**验收标准**：
1. 当 agent 即将调用 `generate_storyboard_image` 时，弹出"即将生成"预览卡片
2. 卡片显示：参考图、当前 prompt、模型、预计耗时/费用
3. 用户可改 prompt、换模型、加参考图、点"确认生成"或"跳过"
4. 跳过时 agent 决定下一步：可能换工具 / 直接进入下一步 / 反问用户

### US-4：分支 — A/B 测试

> **作为**广告创意
> **我想要**同一个场景生成 3 种不同的镜头风格
> **以便于**选最好的给客户

**验收标准**：
1. 用户右键 Artifact 节点 → "从此处分支"
2. 系统创建一个 Branch 节点，子任务图从该点复制
3. 用户在子任务图上点"重新生成"时，agent 用新参数生成，对比展示

### US-5：上传参考图 — 全局应用

> **作为**美术指导
> **我想要**上传一张风格参考图后，所有分镜都自动用它
> **以便于**保持视觉一致

**验收标准**：
1. 工具栏"全局参考图"按钮
2. 上传后该图出现在画布上，标记为 `GlobalRef`
3. agent 在所有 `generate_storyboard_image` 工具调用中自动注入该图作为参考

### US-6：失败恢复

> **作为**用户
> **我想要**当某个 API 调用失败时，agent 能自动重试或换模型
> **以便于**我不会因为一次网络问题就得从头开始

**验收标准**：
1. 失败节点显示错误信息
2. agent 默认策略：重试 1 次 → 换备用模型 → 跳过该资产
3. 每次失败重试都更新 Action 节点的 status（`retrying` → `success` / `failed`）
4. 完全失败时给用户 3 选项：重试 / 换模型 / 跳过

---

## 5. 核心交互模式

### 5.1 画布区域分工

```
┌─────────────────────────────────────────────────────────────────┐
│  [顶部] Goal 节点 (用户原话) + Status 徽章                       │
├──────────────┬──────────────────────────────────┬───────────────┤
│  [左侧]      │  [中央]                            │  [右侧]       │
│  Agent       │  任务图 (无限画布)                  │  详情面板     │
│  Thought     │  - Decision / Action / Artifact    │  - 选中节点   │
│  Stream      │    节点按时间线+空间布局              │    详细信息   │
│  + Tool      │  - 边表示依赖关系                   │  - 重做/改    │
│  Palette     │  - 节点可点击、可拖动、可缩放       │    prompt     │
│  (快捷)      │                                    │  - 资产预览   │
└──────────────┴──────────────────────────────────┴───────────────┘
```

### 5.2 Thought Stream（核心差异化体验）

左侧侧栏，**永远显示** agent 的"内心独白"：

```
🤖 Director Agent

10:23  我先把这段小说拆成 3 个 sequence，
       每个 sequence 大约 30 秒，这样能保证
       整体节奏紧凑...
       [调用 generate_script] ✓

10:24  脚本出来了，我看到主角是 "林尘"，
       我先做他的三视图。需要写一段详细
       的 face anchor prompt...
       [调用 generate_character_portrait] ⏳ 12s

10:25  角色图已经完成，下一步是道具和场景。
       剧本里提到了 "天机令" 和 "心魔",
       我先做这两个关键道具...
```

**关键设计**：
- 滚动到底部自动 follow
- 每条 thought 有 timestamp + 状态图标
- 鼠标 hover 显示 token 用量 / 耗时 / 成本
- 点击跳转画布上对应节点

### 5.3 工具面板（Tool Palette）

左侧侧栏底部，常驻可拖拽：

```
┌─ 工具面板 ─────────────────────┐
│ 🧠 分析                        │
│   • generate_script            │
│   • analyze_story_rhythm       │
│                                │
│ 🎨 视觉                        │
│   • generate_character_portrait│
│   • generate_prop_image        │
│   • generate_scene_image       │
│   • generate_storyboard_image  │
│                                │
│ 🎬 视频                        │
│   • generate_video             │
│   • stitch_videos              │
│                                │
│ 🔊 音频                        │
│   • generate_voiceover         │
│   • generate_bgm               │
│                                │
│ 📦 资产管理                     │
│   • save_asset                 │
│   • upload_reference           │
└────────────────────────────────┘
```

**用户可**：
- 点击查看每个工具的说明、参数、费用
- 拖拽到画布上 = 强制 agent 在某处用这个工具
- 标记"禁用" = agent 不会再用

### 5.4 关键交互流程

**流程 1：完整创作**
```
1. 用户输入目标 → Goal 节点
2. agent 进入 Plan 阶段：
   - 创建 Plan 节点，列出将要做的事
   - 用户可"修改 plan"或"接受 plan 继续"
3. agent 循环执行：每步 = Thought → ToolCall → Result → Artifacts
4. 完成后显示"全部完成" + 总耗时 + 总费用
5. 用户可"导出"或"继续优化"
```

**流程 2：中途修改**
```
1. 用户在某 Artifact 节点上点"修改"
2. 弹出修改对话框：改 prompt / 换模型 / 加参考
3. agent 在该节点后插入一个"重做"分支
4. 旧 Artifact 标记为 deprecated，新 Artifacts 是主分支
```

**流程 3：手动接管**
```
1. agent 走到某步需要决策
2. 抛出"用户决策点"：弹卡片显示 2-3 个选项
3. 用户选 / 写自己的 / 让 agent 决定
4. 继续执行
```

---

## 6. 工具集（v1.0）

| 工具名 | 类别 | 输入 | 输出 | 预计耗时 | 用户需审核 |
|---|---|---|---|---|---|
| `parse_user_goal` | planning | 用户原话 | 结构化目标 | <1s | ✗ |
| `create_plan` | planning | 目标 + 上下文 | 步骤列表 | 3-5s | ✓ |
| `generate_script` | llm | 小说/创意 | Script JSON | 10-30s | ✗ |
| `extract_characters` | llm | Script | Character[] | 5-10s | ✗ |
| `extract_props` | llm | Script | Prop[] | 5-10s | ✗ |
| `extract_scenes` | llm | Script | SceneAsset[] | 5-10s | ✗ |
| `extract_shots` | llm | Script + Scenes | BigShot[] | 15-30s | ✗ |
| `optimize_prompt` | llm | Draft prompt | Optimized prompt | 3-5s | ✗ |
| `generate_character_portrait` | image | Character + prompt | Image URL | 15-30s | ✓ |
| `generate_prop_image` | image | Prop + prompt | Image URL | 10-20s | ✗ |
| `generate_scene_image` | image | SceneAsset + prompt | Image URL | 15-30s | ✓ |
| `generate_storyboard_image` | image | BigShot + prompt | Image URL | 15-30s | ✓ |
| `generate_video` | video | BigShot + prompt | Video URL | 60-180s | ✓ |
| `generate_voiceover` | audio | Dialogue | Audio URL | 5-15s | ✗ |
| `generate_bgm` | audio | Style + duration | Audio URL | 10-30s | ✗ |
| `save_asset` | asset-mgmt | AssetRef + metadata | Asset record | <1s | ✗ |
| `upload_reference` | asset-mgmt | File | Reference Asset | <2s | ✗ |
| `ask_user` | planning | Question | User answer | 待用户 | ✓ |

**Agent 自主调用 = ✗ ，需要用户先确认 = ✓**

---

## 7. 画布节点类型

| 节点类型 | 视觉 | 用途 |
|---|---|---|
| **Goal** | 圆角大节点，顶部 | 任务起点，显示用户原话 |
| **Plan** | 横长条，Goal 下方 | 列出 5-10 步计划 |
| **Decision** | 菱形，蓝色 | agent 决策点，"为什么做这个" |
| **Action** | 矩形，工具图标 | 工具调用，显示状态色 |
| **Artifact** | 矩形+缩略图 | 产出物（图片/视频/JSON） |
| **Branch** | 圆形，从 Artifact 分出 | 分支决策 |
| **User** | 圆角卡片，紫色 | 用户介入点 |
| **Error** | 红色边框节点 | 错误标记 |

---

## 8. 商业模式

### 8.1 订阅

- **免费版**：每月 3 个 Task、仅 OpenAI Provider
- **专业版**（$29/月）：30 个 Task、所有 Provider、优先级队列
- **企业版**（自定义）：API 接入、私有部署、定制训练

### 8.2 用量计费

- LLM token 用量按市场价
- 图片生成按次计费（$0.02-$0.10/张）
- 视频生成按秒计费（$0.05-$0.30/秒）

### 8.3 成本控制

- 用户设置单次 Task 上限（默认 $5）
- 工具调用前显示预估成本，用户可拒绝
- 失败重试不重复计费（用前次 token）

---

## 9. 成功指标

| 指标 | 基线 | 目标 (90 天) |
|---|---|---|
| **完成率** | 当前 ~60% | ≥85% |
| **平均完成时间** | 8 分钟 | 4 分钟 |
| **用户介入率** | 0% | 30-50%（说明用户在参与） |
| **重做率** | 未知 | ≤20%（首次生成即满意） |
| **日活/周活** | 0 | DAU 100, WAU 500 |
| **NPS** | - | ≥40 |

---

## 10. 范围与里程碑

### MVP（v1.0）— 8 周

- [x] PRD & Plan 文档
- [ ] 后端 Agent 框架（ReAct loop + Tool registry）
- [ ] 前端 Thought Stream 组件
- [ ] 任务图节点类型（Goal/Plan/Action/Artifact/User）
- [ ] 5 个核心 LLM 工具
- [ ] 3 个图像生成工具
- [ ] 1 个视频生成工具
- [ ] 用户介入点（修改 prompt、换模型）
- [ ] 失败重试机制
- [ ] API 配置兼容现有

### v1.1 — 4 周

- [ ] 完整 18 个工具
- [ ] 分支与 A/B 测试
- [ ] 全局参考图
- [ ] 导出功能（JSON + ZIP）
- [ ] 历史项目回放

### v1.2 — 4 周

- [ ] 语音输入（用户口述创意）
- [ ] 多 Agent 协作（导演 + 摄影 + 编剧）
- [ ] 模板市场

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| LLM 决策不可控，乱调工具 | 高 | Plan 阶段让用户审核 + 工具白名单 |
| 单 Task 成本失控 | 高 | 强制成本上限 + 每步预估 |
| Agent 卡死（无限循环） | 中 | 超时 + 最大步数限制（默认 30 步） |
| 用户失去耐心 | 中 | 默认关键资产让用户确认 + 实时 thought stream |
| 工具错误导致下游雪崩 | 中 | 工具调用 sandbox + 失败隔离 |
| 竞品快速跟进 | 中 | 押注"代驾体验"差异化 |

---

## 12. 后续讨论

- [ ] 是否需要 voice mode（用户语音指挥 agent）？
- [ ] 是否需要"模板市场"（用户卖/买 agent 配置）？
- [ ] 是否开源 agent 框架部分？

---

> **下一步**：阅读 `plan.md` 查看技术实施计划。
