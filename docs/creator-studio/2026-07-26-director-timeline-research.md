# 导演台/剪辑台（Studio）调研：现状、玩法与集成建议

> 调研日期：2026-07-26，分支 `refactor/runway-ui`。
> 范围：`components/studio/`、`backend/app/agent/{studio,director,studio_tasks,studio_export}.py`、`backend/app/routers/studio.py`。

## 一句话结论

后端"五角色多 agent 骨架 + 三角闭环 + ffmpeg 导出 + Story Bible 依赖图"完整且有测试；
前端已收敛为**人工决策流**：素材车间产料 → 导演台审核整理 → 剪辑台手动/LLM 编排 → 导出 mp4。
多 agent 自动化当前只剩两个真实触点：**单镜头闭环（regenerate）** 和 **arrange 编排建议**；
整集自动生成（`/studio/episodes`）前端已下线，后端 API 成为死代码。

## 1. 玩法（用户旅程）

### 导演台（DirectorDesk.tsx:1-21 docstring 为权威说明）

1. 进入 → `POST /api/assets/rebuild-from-nodes`（画布产物同步为 Asset）→ 拉 drama-task 脚本 `bigShots` + 资产 + 审片记录；
2. bigShot ↔ Asset 按 **URL 完全相等**匹配（多版本取最高 version）——脆弱，重新生成换 URL 即断链；
3. 人审：行内通过/退回（`POST /api/studio/shots/{id}/review`），critic 只是初筛，**人审终审**；
4. 单镜头重生成：`POST /api/studio/shots/regenerate`（同步 1–2 分钟，真实烧生成额度）；
5. "送入剪辑台"：镜头按脚本序组成 TimelineItem[]（默认 3s/镜头）灌入时间线。

### 三角闭环（studio.py:195-291）

每镜头 ≤3 轮（clamp 1–5）：编剧（brief+身份块+`[CRITIC FEEDBACK]` → shot_prompt）→
美术（`_openai_image` i2i 带角色卡参考图，落 `Asset(origin="studio")`，
extra 写 brief/character_card_ids/story_entity_ids）→ 质检（`inspect_asset` +
逐卡 `check_consistency` score≥0.6）。跑满轮次 → `max_rounds_exceeded`，
落最后一版资产并标记 `pending_review` 交人审，不抛错。

### 剪辑台

- 数据模型：纯前端内存态扁平 `TimelineItem[]{asset, sec, caption}`（types.ts:7-11），
  无持久化、无真实多轨（A1/字幕轨是占位 div）；
- 播放：100ms interval 虚拟播放头（use-sequence-playback.ts），视频 clip 用原生 `<video>` 同步；
- 编排：`POST /api/studio/arrange`（editor agent 给叙事排序 + sec/caption 建议，失败降级原顺序）；
- 导出：ffmpeg 1280x720 pad / 30fps / 无音轨 concat → mp4，登记 `Asset(asset_kind="sequence")`。
  **caption 在导出产物中完全丢失**（export 只传 asset_ids + durations）。

## 2. 多 agent 真相

| 角色 | 实质 |
|---|---|
| 导演 director.py | LLM 只拆故事成 3–8 个 brief，逐镜头**串行**调闭环 |
| 编剧 studio.py | LLM 写单镜头生成 prompt，必须逐条修正质检反馈 |
| 美术 | 无 LLM，确定性 i2i 调用 |
| 质检 | 两个 vision 检查取与（通用角色标准 + 逐卡一致性） |
| 剪辑 | 无 LLM，ffmpeg 管道 |
| 编排 arrange | LLM 排序建议 |

- 信息传递：黑板模式（StudioStep trace + Asset.extra），不共享对话上下文；
- **与主 Agent（runtime.py ReAct）是两套完全独立系统**，只共享 llm_factory/media 路由/Asset 模型。

## 3. 与本期资产工作的集成现状

- **单向集成**：画布 → rebuild-from-nodes → Asset → 工作室；studio 镜头**不回画布**；
- Story Bible 层已双向打通：镜头 extra 带 `story_entity_ids`，实体级影响分析
  `GET /api/studio/entities/{id}/impact` 存在，但**前端无 UI 消费**；
- 剪辑 clip 可混排画布资产与 studio 资产（都是 Asset 行）。

## 4. 技术债 Top 5

1. **两套 agent 体系并存语义重叠**：ReAct runtime 与硬编码 RoleAgent 流程无共享编排层；
   `/studio/episodes` 前端死代码（apiClient.ts:418-425）。
2. **episode 任务注册表纯内存**（studio_tasks.py）：重启丢任务、无法恢复。
3. **导演台 URL 匹配脆弱**：bigShot↔Asset 靠 URL 字符串相等，无显式外键。
4. **时间线纯内存态**：刷新即丢；caption 导出丢失（字幕烧录未做）。
5. **质检标准错配**：critic 用角色资产标准而非镜头级标准；一致性解析失败默认放行
   （consistent=True, score=0.5，character_cards.py:229）可能"静默通过"；单镜头最多 5 次真实生成，无成本预估。

另：TransportBar/ClipInspector 大量视觉占位按钮（播放速度/Split/Transform/音量滑条均无逻辑）。

## 5. 集成建议（按优先级）

1. **镜头回画布**：studio 生成的 shot 资产以节点形式落画布（docs Phase 3 规划已久），
   让画布连线引用（asset_ref）直接覆盖工作室产物——打通本期资产编排与工作室；
2. **实体影响分析 UI**：导演台镜头行显示"该镜头引用的实体"，实体变更时用
   `/studio/entities/{id}/impact` 提示受影响镜头（后端已就绪，纯前端工作）；
3. **导演台断链修复**：bigShot ↔ Asset 改为显式 id 关联（bigShot 数据里记 asset_id），
   替代 URL 匹配；
4. **时间线持久化**：TimelineItem[] 落库（项目级 sequence 表），顺带让 caption 进入导出
   （先烧录字幕或至少随产物登记）；
5. **episode 注册表持久化 + 与 ReAct runtime 编排层合并**：长期方向，把 RoleAgent 固定流程
   表达为 runtime 可执行的工作单元（对接路线图阶段 5 的子任务恢复）；
6. **质检镜头级标准 + 结构化 diff**：critic 换镜头级检查清单；一致性检查加 Story Bible
   字段 diff 前置（本期待做项，见 §6.2 愿景），vision 降级为抽检。

## 6. 测试与验证缺口

- 后端 studio 全链路 hermetic 测试良好（7 文件 ~1350 行）；前端 studio-panel.test.tsx ~24 用例；
- **真机端到端未验证**（依赖 vision chat 模型配置）；
- entity impact 端点前端零覆盖（无 UI）。
