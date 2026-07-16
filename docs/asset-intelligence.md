# 资产智能工作流

## 生命周期

1. `POST /api/uploads/asset` 将文件保存到当前项目并创建 `origin=uploaded`、`inspection_status=pending` 的资产。
2. Agent 调用 `inspect_asset`，使用绑定的视觉 LLM 判断资产类别、主体数量、视觉身份和参考能力。
3. 单人物照片等不符合项目标准的资产通过 `prepare_character_asset` 创建标准化衍生资产。衍生资产保留 `source_asset_id`，原上传不会被覆盖。
4. 图片/视频工具使用 `reference_asset_ids`。服务端拒绝跨项目 ID，并优先使用已 ready 且支持目标媒体类型的标准化衍生资产。
5. 每次实际引用都会增加 `usage_count`，生成结果在 `extra` 中保留引用信息。

## 角色标准

默认角色标准包含一个主体、正面/侧面/背面/四分之三视图、浅色背景和跨视图一致性。风格差异本身不会触发重新生成；只有结构缺失或低置信度才会标准化或请求用户确认。

## 能力限制

- 没有视觉能力的 LLM 不能执行上传资产分类，Agent 必须说明原因。
- provider 不支持参考图时，系统不能伪造 URL；应显示阻塞原因并让用户选择替代 provider、跳过引用或上传符合要求的资产。
- 所有资产均以 `project_id` 隔离，不能引用其他项目的资产。
