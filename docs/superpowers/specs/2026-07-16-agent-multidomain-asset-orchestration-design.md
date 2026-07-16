# Agent 多类型视频创作与资产编排设计

## 目标

将 Agent 从“根据用户目标调用工具”扩展为统一的任务编排器，使其能够根据意图处理剧情短片、纪录片、宣传片、电商广告和自定义视频任务，同时承担资产管理员、资产生产员和视频创作者的职责。

核心要求是：任何媒体生成都必须建立在正确的结构化来源、规则包和提示词优化之上；用户上传资产必须可识别、可标准化、可追溯和可复用；任务失败或用户回答后可以从稳定状态恢复，不重复创建资产，也不绕过前置步骤。

## 设计边界

第一阶段支持以下任务类型：

- `drama_short`：剧情短片 / 短剧
- `documentary`：纪录片
- `promotion`：宣传片
- `commercial`：电商广告
- `custom`：自定义任务类型

第一阶段不负责自动剪辑成片、复杂时间线编辑器或多用户协作。它负责从用户目标到结构化来源、资产、分镜、视频生成任务的完整编排，并为后续成片模块提供稳定输入。

## 全局不变量

1. 没有结构化来源时，不得直接生成剧情媒体资产。
2. 所有角色、场景、道具、分镜和视频生成都必须经过提示词优化。
3. `constants.ts` 中的固定提示词模板是生成结构的硬约束。
4. 资产库文档中的字段、材质、角色与道具分离规则必须通过校验器执行。
5. 分镜必须关联对应场景、角色和道具资产；视频必须继承分镜和参考资产关系。
6. 失败重试复用原资产稳定 ID，不得重复创建资产。
7. Agent 的思考、动作、观察、计划、提问和恢复状态只进入 ThoughtStream / 桌宠面板；画布只显示资产节点。
8. 用户回答必须持久化，并恢复到产生提问的工作流状态。
9. 用户明确提供的规则优先于任务默认值，但不能覆盖安全、数据完整性和资产引用硬约束。

## 任务画像

意图识别的第一产物不是工具调用，而是 `TaskProfile`：

```ts
type TaskProfile = {
  taskType: "drama_short" | "documentary" | "promotion" | "commercial" | "custom";
  inputMode: "topic_only" | "script" | "brief" | "product_info" | "uploaded_assets" | "mixed";
  sourceKind: "script" | "interview_outline" | "promotion_brief" | "product_brief" | "mixed";
  scriptRequired: boolean;
  needsClarification: boolean;
  durationSec?: number;
  aspectRatio?: string;
  style?: string;
  deliverables: string[];
  assetStrategy: "generate_from_source" | "normalize_uploaded" | "reuse_existing" | "mixed";
  confidence: number;
  missingInputs: string[];
  rulePackId: string;
};
```

### 识别规则

- 只有一两个主题词时，`inputMode=topic_only`、`needsClarification=true`，不得进入媒体生成。
- 用户提供完整剧本时，直接进入脚本校验和资产提取。
- 用户上传素材时，先进入资产检查；不能因为图片存在就假定它符合角色、场景或道具标准。
- 宣传片优先识别品牌、产品、受众、传播目标和行动号召。
- 电商广告优先识别商品、卖点、规格、使用场景和目标人群。
- 纪录片优先识别事实来源、采访对象、地点、时间线和证据素材。
- 无法可靠判断任务类型时，询问用户确认类型，并允许自由输入。

### 前置条件

| 任务类型 | 结构化来源 | 生成资产前必须具备 |
|---|---|---|
| 剧情短片 | 剧本或用户授权生成的剧本 | 剧本、角色/场景/道具提取结果 |
| 纪录片 | 采访提纲、事实资料或素材清单 | 事实来源和内容结构 |
| 宣传片 | 传播 brief 或用户授权生成的 brief | 产品/品牌信息和传播目标 |
| 电商广告 | 商品信息、卖点和目标人群 | 商品结构和卖点镜头计划 |
| 自定义 | 由用户确认的来源类型 | 与任务类型对应的来源 |

## 规则包

规则包将 `constants.ts`、资产库文档、分镜解析文档和视频提示词模板中的规则组织成可加载、可验证的任务配置。

```ts
type RulePack = {
  id: string;
  version: string;
  taskTypes: string[];
  sourceDocuments: string[];
  hardRules: string[];
  promptTemplates: string[];
  validators: string[];
  workflow: WorkflowStep[];
};

type WorkflowStep = {
  id: string;
  tool: string;
  dependsOn: string[];
  inputKinds: string[];
  outputKinds: string[];
  approval: "none" | "user" | "automatic";
  parallelGroup?: string;
};
```

规则优先级固定为：

1. 安全和数据完整性规则
2. `constants.ts` 固定模板
3. 资产库字段和材质规则
4. 分镜与视频模板规则
5. 任务类型规则
6. 用户明确要求

前端和后端必须通过测试保证角色设计图、分镜图和视频模板没有分叉。后端不能直接依赖运行时读取 TypeScript，因此需要建立带版本和来源标识的后端规则映射；规则测试必须检查映射仍然包含模板中的关键硬约束。

## 资产图谱

资产从“生成结果”升级为带生命周期和关系的实体。

```text
原始上传资产
  └─ inspect_asset
       └─ 识别结果
            └─ prepare_character_asset / prepare_prop_asset / prepare_scene_asset
                 └─ 标准化资产
                      └─ approve_asset
                           └─ storyboard / video references
```

每个资产至少包含：

- `asset_kind`：`character`、`prop`、`scene`、`storyboard`、`video`、`script`、`source` 等
- `origin`：`upload`、`generated`、`normalized`、`imported`
- `source_asset_id`：标准化资产的来源资产
- `status`：`pending`、`inspecting`、`ready`、`needs_review`、`generating`、`failed`
- `version`
- `prompt_source` 和 `prompt_optimized`
- `provider_id` 和 `model_id`
- `reference_role`
- `used_by` / `derived_from`

### 上传资产流程

用户上传角色图时：

1. 多模态模型识别主体、资产类型和可复用信息。
2. 判断是否符合项目角色设计图标准。
3. 不符合时，保留原图并生成关联的角色设计图 / 三视图。
4. 新资产的 `source_asset_id` 指向原图。
5. 后续分镜和视频只默认引用标准化资产，除非用户明确选择原图。

道具和场景采用相同的检查与标准化思路，但角色、道具、场景不能互相混入。

## 提示词生产链

媒体节点不得把结构化描述直接传给 provider：

```text
结构化来源
  + 任务规则包
  + 已批准参考资产
  + 固定模板
      ↓
原始描述 Prompt
      ↓
提示词优化
      ↓
规则校验
      ↓
Provider Prompt
      ↓
媒体生成
```

### 角色

必须使用 `constants.ts` 的角色设计图版式：左侧胸像特写，右侧正面、侧面、背面全身视图；保持脸部、服装、发型和配饰一致；禁止文字、编号和标注。

### 场景

使用资产库中的七层场景结构，固定世界定位、地理关系、主体结构、扩展空间、远景、光色和技术规格。

### 道具

道具独立于角色生成，使用材质可触摸标准、结构、工艺、装饰、功能和特殊状态字段；道具图不得出现人物或手。

### 分镜

分镜 Prompt 必须由以下输入共同产生：

- 分镜描述
- 对应场景资产
- 出场角色资产
- 出场道具资产
- 项目视觉签名

节点连接表示引用关系：角色、场景、道具节点可连接到分镜生成节点；分镜节点可连接到视频生成节点。

### 视频

视频 Prompt 必须继承分镜中的有效镜头，不得自行增加镜头；参考图顺序固定为故事板、角色、场景、道具；动作描述必须从静态分镜转化而来，并保留人物、场景、位置和视觉风格一致性。

## 四类工作流

### 剧情短片

```text
意图识别
→ 主题澄清 / 生成剧本
→ 用户确认剧本或目标
→ 提取角色、道具、场景、分镜
→ 生成并审核资产
→ 生成分镜
→ 用户确认分镜
→ 并行生成视频片段
```

### 纪录片

```text
素材/采访提纲检查
→ 事实和人物清单
→ 时间线与章节结构
→ 地点/人物/资料资产整理
→ 纪录片分镜
→ 采访和环境镜头 Prompt
→ 视频片段
```

纪录片默认不得编造事实。缺失信息应标记为待确认，而不是由模型擅自补齐。

### 宣传片

```text
品牌/产品/传播目标识别
→ brief 确认
→ 创意脚本
→ 产品与品牌资产
→ 卖点镜头计划
→ 分镜与视频 Prompt
→ 并行生成片段
```

### 电商广告

```text
商品图/商品信息检查
→ 商品结构化识别
→ 卖点、受众、场景确认
→ 商品标准图和细节图
→ 卖点镜头
→ 模特/场景资产
→ 分镜与视频片段
```

商品原始外观必须保持一致，生成模型不得擅自修改品牌标识、产品结构和规格信息。

## Agent 与 subagent

主 Agent 负责：

- 识别任务类型
- 管理任务状态和用户提问
- 决定工作流阶段
- 汇总 subagent 结果
- 控制资产引用和最终流程

subagent 负责隔离的局部任务，例如：

- 资产识别与分类
- 角色标准化
- 单批次提示词优化
- 失败媒体任务修复
- 纪录片事实一致性检查

subagent 不得直接修改主任务状态，不得创建脱离主任务的重复资产。返回结果必须包含 `task_id`、`subtask_id`、输入资产版本、输出资产 ID、状态和错误信息。

## 状态与恢复

每个工作流步骤都保存：

- `step_id`
- `status`
- `input_asset_ids`
- `output_asset_ids`
- `rule_pack_version`
- `pending_question`
- `error`
- `retry_count`

用户回答后，系统必须根据 `pending_question.step_id` 恢复，而不是重新从任务目标推理一遍。媒体失败只更新原资产状态；重试沿用原资产 ID。批量媒体生成允许并行，单个失败进入独立恢复分支，不阻塞其他成功任务。

## 前端反馈

ThoughtStream 展示：

- 当前任务类型和阶段
- 当前规则包
- 正在等待的输入
- 资产检查、标准化、提示词优化和生成进度
- subagent 状态
- 失败资产的重试状态

画布只展示资产节点和真实资产引用关系。没有生成结果时不创建伪资产节点；准备中的资产可以显示明确的 `pending` 节点，但必须关联真实工作流步骤。

## 验收标准

1. 输入“功夫”时，Agent 不创建角色、场景或分镜生成节点，而是提出脚本前置问题。
2. 用户选择“由 agent 编写脚本”后，流程先生成脚本，再提取和生成资产。
3. 用户上传单人物图片时，系统能识别角色并生成关联标准角色设计图。
4. 分镜生成节点能够接收场景、角色和道具节点的参考资产。
5. 视频 Prompt 的镜头数和分镜有效镜头数一致，参考图顺序正确。
6. 纪录片缺少事实来源时进入待确认状态，不自动编造事实。
7. 电商广告中商品结构、品牌标识和规格不会因 Prompt 优化而被改写。
8. 任意用户提问刷新后仍能找回，回答后从原步骤继续。
9. 任意媒体失败重试不产生重复资产。
10. Agent 停止后不会继续执行迟到的 provider 或 subagent 结果。

## 实施分解

后续实施计划应拆成四个可独立验证的子项目：

1. 任务画像与规则包：完成意图识别、任务类型、前置条件和工作流选择。
2. 资产图谱与标准化：完成资产生命周期、上传识别、版本和引用关系。
3. 分镜与视频编排：完成参考资产连线、提示词优化链和视频镜头一致性校验。
4. subagent 与恢复体验：完成并行子任务、失败隔离、进度反馈和恢复测试。

每个子项目单独编写测试和浏览器验收用例，完成后再进入下一个子项目。
