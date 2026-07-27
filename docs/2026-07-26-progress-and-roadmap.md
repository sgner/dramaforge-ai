# 资产引用编排与 Story Bible：进展总结与未来计划

> 日期：2026-07-26 ｜ 分支：`refactor/runway-ui`（与远端同步，HEAD `a1426e9`）
> 范围：本会话从"画布资产引用编排"开始，贯穿资产复用、Story Bible、工作室整合与长期技术债清理。

## 一、已完成工作（按提交线）

### 1. 画布资产引用编排（asset-intelligence 计划 Phase 3）

- `873ebf6` 画布连线 `asset_ref` 接入 `generate_video` / `generate_media_batch`；
  修复显式 `reference_urls` 被 `reference_asset_ids` 覆盖丢弃的问题。
- `4fb754a` **AssetUsage 使用记录**：`asset_usages` 表 + `record_asset_usage`（幂等）+
  `finish_media_asset` 成功钩子 + `GET /api/assets/{id}/usage`。
- `2395764` `generate_video` 按 shot 文本继承场景/角色/道具引用；所有媒体工具返回
  `reference_asset_ids` 打通使用记录链路。
- `fefdd84` **usage_count 语义修正**：只在 provider 接受后计数（解析阶段不计），
  避免失败/取消虚增；契约测试同步更新。
- `4e9c3e7` **fallback_url**：选中标准化衍生图时原始上传图作为兜底参考（全链路）；
  `check_reference_support` 结构化判定 + `generate_with_reference_check` 降级
  （t2x 模型无 i2x 变体时降级为无参考生成 + agent_notice）；顺带修复 7/23 遗留的工具计数测试。
- `5281272` **阶段 3 闸门套件**（test_asset_phase3_gate.py）：上传→检查→标准化源图保留、
  一道具多镜头引用、分镜三类参考、重试不重复、跨 3 分镜一致性。

### 2. asset-intelligence 计划 Phase 4 / 5

- `b88c953` 批量 job 透传 `reference_asset_ids`；`test_agent_cancellation.py`
  （批量中途取消、stop 取消双 job、取消后重试排空复位）；pending 资产事件先于 provider 调用。
- `98fe40b` **媒体恢复可见性**（按"失败即暂停"决策收缩）：`media_recovery_progress` 事件 +
  ThoughtStream 渲染 + 桌宠面板参考资产名。
- `c40188f` 4.1 端到端：上传→标准化→分镜不重复生成角色。
- `9e15ed4` **Phase 5 前端**：检查结论结构化摘要、标准化文案、派生关系显示与连线、
  桌宠引用标签（角色·标准化）、**identify 确认类型 UI**（四语言 i18n）、项目隔离测试。

### 3. 角色声音画像

- `30c4419` `Asset.voice_id` 列 + 迁移 + schema 透传；`generate_voiceover` 按
  `character_asset_id` 继承角色音色（显式 voice > 资产 voice_id > 默认）。
- `ab61601` identify 卡片选"角色"时出现音色下拉，随 identify 持久化。

### 4. Story Bible 完整化（两系统合并）

- `768ce17` 建卡即实体（`create_character_card` 绑 `story_entity_id`）；镜头写
  `extra.story_entity_ids`；`card_impact` 双路径去重 + 实体级
  `GET /api/studio/entities/{id}/impact`；identify 带 `extract_identity` 复用建卡提取链路。
- `e99f155` 资产卡实体徽章：点击查看"出现于 N 个镜头"（实体影响分析 UI）。

### 5. 工作室（导演台/剪辑台）整合

- `a05521f` 调研文档：`docs/creator-studio/2026-07-26-director-timeline-research.md`。
- `1301032` studio 镜头回画布（确定性节点 id，data 遵循 rebuild 约定防重复同步）。
- `a3cb655` **断链修复**：bigShot↔Asset 改 `extra.bigshot_id` 显式关联，URL 兜底 + 自愈回写。
- `44221b9` **时间线持久化**：`studio_timelines` 表 + GET/PUT 端点 + 前端 hydrate/去抖保存；
  captions 随导出登记。
- `59e7eea` **episode 任务持久化**：`studio_episode_tasks` 表，重启可查，
  残留 running 标记 interrupted。
- `5a2657d` **镜头级质检标准**：`SHOT_STANDARD`（构图/运镜/连续性/保真度），不再复用角色标准。
- `be6e795` 一致性解析失败交人审（不再静默通过，不再白烧生成轮次）。
- `48036ee` **字幕烧录**：captions 经 ffmpeg drawtext 烧入导出 mp4（字体候选链 + 转义）。
- `7985b02` **编排层合并**：studio 流程封装为 ReAct 工具（`studio_generate_shot` /
  `studio_generate_episode`），获得 SSE（`studio_step`）/取消/持久化；ALL_TOOLS 27。

### 6. 推送事故与恢复

- 当天 github.com:443 被 SNI 阻断（api.github.com 通），编写
  `scripts/push-via-github-api.py` 经 Git Data API 重放 11 个提交；网络恢复后
  `fetch + reset --mixed` 对齐（树内容零偏差）。脚本留作备用。

## 二、验证基线

- 后端全量：**876 passed, 9 skipped**（唯一忽略：`test_openai_llm_client`，环境缺 respx）
- 前端：tests/agent + tests/infinite-canvas 全量通过；studio-panel 29 例
- tsc：改动文件无新增错误（存量错误为既有技术债，见 agent-design.md 附录 A）

## 三、未来计划

### 近期（下一迭代候选）

1. **agent 提问 i18n**（计划 `2026-07-19-agent-question-i18n.md`，18 步全未做）：
   任务创建时语言持久化（zh/en/ja/ko）→ user_messages 翻译表 → 前端传 language。
   注意：`user_messages.py` 四语言框架已存在，计划可能部分过时，开工前先核对。
2. **阶段 2 可靠性**（phase2 路线图最高优先级）：任务状态机收敛（幂等 stop/retry/resume、
   pending_question 绑定、终态停 SSE 重连）、事件流可靠性、DB 迁移与持久化。
   目标闭环：创建→提问→回答→媒体失败→独立恢复→重试/停止→刷新不重复。
3. **结构化 diff 一致性前置**（此前方案未选项）：check_consistency 前做 Story Bible
   字段级比对，vision 降级为抽检（省钱）。
4. **单镜头成本预估**：闭环前显示"最多 N 轮 ≈ 成本上限"。

### 中期

5. **Story Bible 中心 UI**：实体管理页（角色/道具/场景实体卡 + 影响分析 + 一键重生成入口）；
   场景卡（scene card）系统新建。
6. **阶段 5：并行执行与子任务恢复**（路线图）：可持久化工作单元、批量生成调度——
   届时可把 studio RoleAgent 固定流程表达为工作单元（编排层合并的深化）。
7. **审片台完善**：TransportBar/ClipInspector 的视觉占位控件（播放速度/Split/Transform/音量）
   接入真实逻辑或移除。

### 长期

8. **交付中心**：字幕（已可烧录）之外的配音/BGM/多规格导出。
9. **真机端到端验证**（docs §6.5）：配一个 vision chat 模型，跑通
   故事→拆镜头→三角过审→人审→合成 mp4 全流程。

## 四、已知遗留

- `docs/superpowers/plans/2026-07-15-agent-asset-intelligence.md` Phase 6 未做：
  浏览器端 E2E（tests/e2e）、README/operator 文档、陈旧契约清理（部分已顺带完成）。
- `use-agent-stream.ts` 废弃文件仍在仓库；`activity-indicator.tsx` 死代码；
  幽灵事件（goal_parsed 等 4 个）前后端死分支（agent-design.md 附录 A）。
- 历史 studio 镜头无画布节点（镜头回画布只对新生成生效，需要时可补回填端点）。
- `.superpowers/sdd/recovery/` 下有递归嵌套的 recovery 目录（历史事故残留），可清理。
