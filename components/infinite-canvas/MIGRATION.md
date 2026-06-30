# 无限画布迁移清单

参考项目: `docs/Infinite-Canvas/static/`
目标项目: `components/infinite-canvas/`

参考项目包含两个画布：
- **无限画布** (`canvas.html` / `canvas.js` / `canvas.css`) — 节点式画布，支持多种节点类型、连接线、资产库等
- **智能画布** (`smart-canvas.html` / `smart-canvas.js` / `smart-canvas.css`) — Composer 驱动式画布，底部浮动面板一键生成，支持级联运行

---

## 一、快捷键补全

### 1.1 Ctrl+G 合并选中图片为组 ✅
### 1.2 A 键打开/关闭资产库 ✅
### 1.3 Z 键缩小画布 ✅
### 1.4 Shift 键按住进入 Knife 模式 ✅
### 1.5 Ctrl+V 粘贴剪贴板图片 ✅
### 1.6 Escape 关闭所有弹窗 ✅
### 1.7 Ctrl+C 复制选中节点 ✅
### 1.8 Ctrl+Z 撤销 ✅
### 1.9 Delete/Backspace 删除选中节点 ✅
### 1.10 F 适应视图 ✅
### 1.11 K 切换 Knife 模式 ✅
### 1.12 Ctrl+框选节点 ✅

---

## 二、节点功能补全

### 2.1 图片节点右键菜单 ✅
- ImageNodeMenu.tsx — 预览/编辑/下载/复制链接/替换/删除

### 2.2 图片节点双击预览 ✅
- CanvasNode onNodeDoubleClick + OutputLightbox

### 2.3 图片节点拖放替换 ✅
- CanvasNode ImageNodeBody drop 事件

### 2.4 图片节点视频/音频支持 ✅
- CanvasNode ImageNodeBody mediaKind 渲染

### 2.5 图片节点文件名显示 ✅
- CanvasNode image-caption

### 2.6 空白图片节点点击上传 ✅
- CanvasNode ImageNodeBody fileInput + pickMediaForNode

### 2.7 提示词节点模板库按钮 ✅
- CanvasNode PromptNodeBody prompt-template-btn + PromptTemplateModal

### 2.8 提示词节点字数统计 ✅
- CanvasNode prompt-counter

### 2.9 生成器节点完整 UI ✅
- Provider/Model 选择器、分辨率/比例/质量/数量设置、输入图片列表、输入提示词列表、运行按钮

### 2.10 输出节点 Lightbox ✅
- OutputLightbox.tsx — 缩放/平移/左右切换/下载

### 2.11 输出节点图片拖拽 ✅
- OutputNodeBody draggable + onDragStart

### 2.12 输出节点下载功能 ✅
- OutputLightbox 下载 + ImageNodeMenu 下载

### 2.13 输出节点删除单张 ✅
- OutputNodeBody output-img-delete

### 2.14 组节点双击预览 ✅
- handleNodeDoubleClick 处理 group 类型

### 2.15 节点端口菜单 ✅
- LinkCreateMenu.tsx — 拖线到空白处弹出

### 2.16 生成器节点右键菜单 ✅
- GeneratorNodeMenu.tsx — 运行/重新运行/复制提示词/添加输入输出/删除

### 2.17 所有12种节点类型渲染 ✅
- image, prompt, loop, group, promptGroup, generator, msgen, video, llm, comfy, rh, ltxDirector, output

---

## 三、管理功能补全

### 3.1 资产库侧边面板 ✅
- CanvasAssetPanel.tsx — 资产库选择器、分类、拖放、网格

### 3.2 资产库管理器弹窗 ✅
- AssetManagerModal.tsx — 图片资产/提示词库 Tab

### 3.3 图片编辑器弹窗 ✅
- ImageEditModal.tsx — 裁剪/遮罩/画笔/扩展/宫格模式

### 3.4 输出 Lightbox 弹窗 ✅
- OutputLightbox.tsx

### 3.5 提示词模板库弹窗 ✅
- PromptTemplateModal.tsx — 搜索/分类/新建/编辑/删除/应用

### 3.6 日志面板 ✅
- CanvasLogModal.tsx

### 3.7 错误弹窗 ✅
- ErrorModal.tsx — 标题/消息/复制/关闭

### 3.8 Drop Overlay ✅
- InfiniteCanvas drop 事件 + CSS

### 3.9 API 设置面板 ✅
- ApiSettingsModal.tsx — Provider 管理、API Key 配置、模型列表

### 3.10 画布持久化 ✅
- use-canvas-store.ts — localStorage 自动保存/恢复

### 3.11 工具栏 API 设置/资产管理器入口 ✅
- CanvasToolbar — ⚙ API 按钮 + 🗂 管理按钮

---

## 四、样式补全

### 4.1 资产库面板样式 ✅
### 4.2 资产库管理器样式 ✅
### 4.3 图片编辑器样式 ✅
### 4.4 输出 Lightbox 样式 ✅
### 4.5 提示词模板库样式 ✅
### 4.6 日志弹窗样式 ✅
### 4.7 错误弹窗样式 ✅
### 4.8 节点端口菜单样式 ✅
### 4.9 生成器节点详细样式 ✅
### 4.10 媒体节点样式 ✅
### 4.11 Drop Overlay 样式 ✅
### 4.12 响应式样式 ✅
### 4.13 API 设置面板样式 ✅
### 4.14 生成器输入列表样式 ✅
### 4.15 级联按钮样式 ✅

---

## 五、待后端集成功能

以下功能需要后端 API 支持才能完整实现，当前已提供 UI 框架：

### 5.1 节点运行（API 生成）
- 参考项目: runGenerator / runNodeCascade
- 当前状态: 生成器节点 UI 已就绪，运行按钮已渲染，需接入后端 API

### 5.2 API Provider 动态模型列表
- 参考项目: providerById / allImageModels / providerImageModels
- 当前状态: ApiSettingsModal 已提供 Provider 配置 UI，模型列表为静态硬编码，需接入后端动态获取

### 5.3 画布列表管理（创建/切换/删除）
- 参考项目: saveCanvas / loadCanvasList / deleteCanvas
- 当前状态: localStorage 持久化已实现，多画布管理需后端 API

### 5.4 资产库后端存储
- 参考项目: asset-manager.js 完整的资产库 CRUD
- 当前状态: AssetManagerModal UI 已就绪，需接入后端 API

### 5.5 图片编辑器后端处理
- 参考项目: cropBounds / editDrawCanvas / editTextCanvas
- 当前状态: ImageEditModal UI 已就绪，编辑操作需接入后端

### 5.6 LLM 节点对话
- 参考项目: addLLMNode / chatApiProviders
- 当前状态: LLM 节点使用 GeneratorNodeBody 渲染，对话功能需接入后端

### 5.7 ComfyUI 节点
- 参考项目: addComfyNode / comfyui-settings.js
- 当前状态: ComfyUI 节点使用 GeneratorNodeBody 渲染，设置面板需接入后端

### 5.8 视频生成节点
- 参考项目: addVideoNode / videoApiProviders
- 当前状态: Video 节点使用 GeneratorNodeBody 渲染，视频生成需接入后端

### 5.9 LTX Director 节点
- 参考项目: addLTXDirectorNode / ltx-director-timeline.js
- 当前状态: LTX Director 节点使用 GeneratorNodeBody 渲染，时间线需接入后端

### 5.10 RunningHub 节点
- 参考项目: addRhNode
- 当前状态: RH 节点使用 GeneratorNodeBody 渲染，需接入后端

---

## 六、智能画布迁移（新增）

参考项目中的智能画布（smart-canvas）是一种 Composer 驱动的画布模式，与无限画布共享底层画布引擎，但交互模式完全不同。需要将两种画布模式整合到本项目中。

### 6.1 Composer 智能生成面板 ✅
- 参考项目: `<div id="composer" class="composer">`
- 说明: 智能画布的核心 UI，浮动在画布底部的生成面板
- 功能清单:
  - [x] Engine 选择器（API生成/火山引擎/ModelScope/ComfyUI/RunningHub）
  - [x] API Kind 切换（图片/视频）
  - [x] 输入图片缩略图行（inputThumbsRow）
  - [x] 输入提示词预览（inputPromptPreview）
  - [x] ContentEditable 提示词输入框（promptInput）
  - [x] 提示词模板库按钮（composerTemplateBtn）
  - [x] 动态参数面板（dynamicParams）— 根据引擎类型显示不同参数
  - [x] 运行按钮（runBtn）
  - [x] 一键运行按钮（cascadeRunBtn）
  - [ ] 提示词高度拖拽调整（promptResize）
- 新建文件: `ComposerPanel.tsx`

### 6.2 一键运行/级联运行 ✅
- 参考项目: `smartCascadeRunForLoop` / `cascadeRunBtn`
- 说明: 从 Loop 节点开始，按连接顺序依次运行所有下游节点
- 功能清单:
  - [x] 级联运行状态管理（smartCascadeRuns Map）
  - [x] 级联运行路径追踪（smartCascadeRunPath）
  - [x] 节点运行状态徽章（queued/running/done/failed）
  - [x] 级联停止按钮（gen-cascade-stop）
  - [x] Loop 节点上下文管理（smartLoopContext）
  - [x] 串行循环模式支持
- 修改文件: `use-canvas-store.ts` 增加级联运行状态

### 6.3 智能画布节点样式 ✅
- 参考项目: `smart-canvas.css` 中 `.image-node` / `.prompt-smart-node` / `.loop-smart-node`
- 说明: 智能画布的节点渲染方式与无限画布不同，更轻量透明
- 功能清单:
  - [x] smart-image 节点 — 透明背景，图片直接展示，浮动操作按钮
  - [x] 提示词智能节点 — prompt-node-card / prompt-node-text / prompt-node-tools / prompt-node-pill
  - [x] 循环智能节点 — loop-smart-card / loop-smart-count / loop-smart-seg / loop-smart-toggle / loop-smart-panel
  - [x] 浮动节点操作按钮（floating-node-actions）
  - [x] 图片分辨率徽章（image-resolution-badge）
  - [x] 智能节点输入缩略图（smart-node-input-thumbs / smart-node-input-thumb / smart-node-input-badge）
  - [x] 节点调整大小手柄（node-resize-handle）
  - [x] 节点关闭按钮（mini-x）
- 修改文件: `CanvasNode.tsx` 增加智能画布节点渲染模式

### 6.4 画布模式切换 ✅
- 参考项目: `canvasGate` 中 `gateCreateSmartBtn` / `createCanvasKind`
- 说明: 需要支持在"无限画布"和"智能画布"两种模式间切换
- 功能清单:
  - [x] 画布类型字段（canvas.kind: 'classic' | 'smart'）
  - [x] 根据画布类型切换 UI 渲染模式
  - [x] 智能画布模式隐藏工具栏节点按钮，显示 Composer
  - [x] 无限画布模式隐藏 Composer，显示工具栏
- 修改文件: `use-canvas-store.ts` / `InfiniteCanvas.tsx`

### 6.5 提示词预设面板 ✅
- 参考项目: `<div id="promptPresetPanel" class="prompt-preset-panel">`
- 说明: 智能画布的提示词预设管理，与模板库不同
- 功能清单:
  - [x] 预设列表选择（promptPresetSelect）
  - [x] 预设名称/内容编辑
  - [x] 应用/删除/新建/保存预设
  - [x] localStorage 持久化
- 新建文件: `PromptPresets.tsx`

### 6.6 智能画布快捷键弹窗 ✅
- 参考项目: `<div id="smartShortcutModal" class="shortcut-modal">`
- 说明: 智能画布专用快捷键帮助面板
- 功能清单:
  - [x] 快捷键列表展示
  - [x] 打开/关闭按钮
- 样式文件: `canvas.css` 中 .shortcut-modal / .shortcut-panel

### 6.7 Mention Picker（@提及选择器）✅
- 参考项目: `<div id="mentionPicker" class="mention-picker">`
- 说明: 在提示词输入框中输入 @ 时弹出资产选择器
- 功能清单:
  - [x] @ 触发检测
  - [x] 资产搜索列表
  - [x] 选中插入到提示词
  - [x] Mention Preview 预览
- 新建文件: `PromptPresets.tsx` 中 MentionPicker

### 6.8 智能画布资产面板差异 ✅
- 参考项目: smart-canvas.html 中的 `assetPanel`
- 说明: 智能画布的资产面板与无限画布略有不同
- 功能清单:
  - [x] 图片资产/工作流 Tab 切换
  - [x] 资产库选择器
  - [x] 分类管理（新建/重命名文件夹）
  - [x] 拖放保存到当前分组
  - [x] 资产悬浮预览
  - [x] 资产命名对话框
  - [x] 远程同步按钮
  - [x] 搜索过滤
- 修改文件: `CanvasAssetPanel.tsx`

### 6.9 智能画布返回导航 ✅
- 参考项目: `<button class="smart-back">` / `<div class="smart-title">`
- 说明: 智能画布顶部的返回按钮和标题显示
- 功能清单:
  - [x] 返回画布列表按钮
  - [x] 画布标题显示
- 修改文件: `InfiniteCanvas.tsx`

---

## 七、无限画布功能差距（补充）

以下是在对比参考项目后发现当前项目尚未实现的功能：

### 7.1 画布管理面板（Canvas Gate）✅
- 参考项目: `<div id="canvasGate" class="canvas-gate">`
- 说明: 画布列表管理入口，支持创建/切换/删除画布
- 功能清单:
  - [x] 画布卡片列表（canvas-item / canvas-card-title / canvas-card-meta）
  - [x] 新建画布按钮（gateCreateBtn）
  - [x] 新建智能画布按钮（gateCreateSmartBtn）
  - [x] 画布标题编辑（canvas-card-title-input）
  - [x] 画布删除确认（canvas-delete-confirm / canvas-delete-box）
  - [x] 画布恢复功能（canvas-restore）
  - [x] 回收站模式（trashMode / gateTrashBtn / gateTrashCount）
  - [x] 画布 Emoji/图标选择器（emoji-picker / canvas-preview-mark）
  - [x] 画布类型标签（canvas-kind-chip）
  - [x] 刷新列表按钮
  - [x] 资产库管理入口
- 新建文件: `CanvasGate.tsx`

### 7.2 多选操作栏（Selection Hub）✅
- 参考项目: `<div id="selectionHub" class="selection-hub">`
- 说明: 选中多个节点时浮出的操作栏
- 功能清单:
  - [x] 显示选中数量
  - [x] 合并为组按钮
  - [x] 删除选中按钮
  - [x] 取消选择按钮
- 修改文件: `InfiniteCanvas.tsx` 中 multi-select-bar

### 7.3 输出 Lightbox 对比模式 ✅
- 参考项目: `outputCompareContainer` / `outputCompareSlider`
- 说明: 生成结果与输入图片的 Before/After 对比滑块
- 功能清单:
  - [x] 对比容器（output-compare）
  - [x] 结果图/原图叠加显示
  - [x] 滑块拖拽对比（output-compare-slider / output-compare-handle）
  - [x] 自动检测是否有输入图可对比
- 修改文件: `LightboxPanel.tsx`

### 7.4 输出 Lightbox 提示词面板 ✅
- 参考项目: `outputPromptPanel` / `outputPromptText`
- 说明: 在 Lightbox 中显示生成使用的提示词
- 功能清单:
  - [x] 提示词文本展示
  - [x] 复制提示词按钮
  - [x] 再次运行按钮
- 修改文件: `OutputLightbox.tsx`

### 7.5 节点输入/输出端口菜单 ✅
- 参考项目: `nodeInputMenu` / `nodeOutputMenu`
- 说明: 右键点击节点端口弹出的菜单
- 功能清单:
  - [x] 输入端口菜单 — 添加图片/提示词输入
  - [x] 输出端口菜单 — 添加输出节点/复制
- 修改文件: `LinkCreateMenu.tsx` 或新建 `PortMenu.tsx`

### 7.6 LLM 节点对话界面 ✅
- 参考项目: `llm-chat-log` / `llm-bubble` / `llm-mode`
- 说明: LLM 节点应有独立的对话界面，而非通用 GeneratorNodeBody
- 功能清单:
  - [x] 对话气泡列表（llm-chat-log）
  - [x] 用户/助手消息气泡（llm-bubble.user / llm-bubble.assistant）
  - [x] 模式切换（chat / instruct / system）
  - [x] 系统提示词输入
  - [x] 发送按钮
- 修改文件: `CanvasNode.tsx` 中 LLM 节点渲染

### 7.7 视频节点专用 UI ✅
- 参考项目: `video-node` / `video-input-head` / `video-input-actions`
- 说明: 视频节点应有专用参数面板
- 功能清单:
  - [x] 视频模型选择（videoProvider / videoModel）
  - [x] 视频时长设置（videoDuration）
  - [x] 视频比例设置（videoAspect）
  - [x] 视频增强提示词开关（videoEnhancePrompt）
  - [x] 视频生成音频开关（videoGenerateAudio）
  - [x] 输入图片/视频列表
  - [x] 视频播放控件
- 修改文件: `CanvasNode.tsx` 中 Video 节点渲染

### 7.8 ComfyUI 节点设置面板 ✅
- 参考项目: `comfyui-settings.js` / `comfyui-settings.css`
- 说明: ComfyUI 节点应有独立的工作流选择和参数配置面板
- 功能清单:
  - [x] 工作流列表选择
  - [x] 工作流参数编辑
  - [ ] 工作流图可视化
  - [x] 模式切换（text/enhance/edit/custom）
  - [ ] 上传自定义工作流
- 新建文件: `ComfyUISettingsPanel.tsx`

### 7.9 RunningHub 节点专用 UI ✅
- 参考项目: `rhConfigKey` / `rhPayment` / `rhParams`
- 说明: RunningHub 节点应有专用配置面板
- 功能清单:
  - [x] 工作流选择
  - [x] 付费模式选择（free/pro）
  - [x] 实例类型选择
  - [x] 参数配置
  - [x] 随机值生成
- 修改文件: `CanvasNode.tsx` 中 RH 节点渲染

### 7.10 LTX Director 节点时间线 ✅
- 参考项目: `ltx-director-timeline.js`
- 说明: LTX Director 节点应有视频时间线编辑界面
- 功能清单:
  - [x] 时间线轨道
  - [x] 片段颜色标记（LTX_SEGMENT_COLORS）
  - [ ] 时间线拖拽编辑
  - [x] 种子值设置
- 新建文件: `LTXTimeline.tsx`

### 7.11 MS Gen 节点专用 UI ✅
- 参考项目: `MS_GEN_MODELS` / `msgenModel` / `msRatio` / `msResolution`
- 说明: MS Gen 节点应有独立的模型和参数选择
- 功能清单:
  - [x] 模型选择（ZImage / Qwen Edit / Klein / 自定义）
  - [x] 比例/分辨率设置
  - [x] 自定义模型 ID 输入
  - [x] LoRA 配置（ms-lora-block / lora-list / lora-row）
- 修改文件: `CanvasNode.tsx` 中 MS Gen 节点渲染

### 7.12 图片编辑器完整功能 ✅
- 参考项目: `imageEditMode` / `editDrawState` / `editTextItems` / `gridCustomMode`
- 说明: 当前 ImageEditModal 是基础框架，缺少详细编辑功能
- 功能清单:
  - [x] 裁剪模式（crop）— 裁剪框拖拽/调整
  - [x] 绘制/遮罩模式（draw）— 画笔/橡皮擦/标签
  - [ ] 文字叠加模式（text）— 文字拖拽/编辑/样式
  - [x] 宫格模式（grid）— 自定义分割线
  - [x] 扩展/外画模式（outpaint）— 方向选择/尺寸设置
  - [x] 旋转模式 — 左转/右转/翻转
  - [x] 滤镜模式 — 灰度/怀旧/模糊/明亮/对比/饱和/反色/色相
  - [x] 调整模式 — 亮度/对比度/饱和度滑块
  - [x] 缩放/平移（imageEditZoom / imageEditPanDrag）
  - [ ] 撤销/重做（editDrawUndoStack / editDrawRedoStack）
  - [ ] 全景预览模式（panoramaState）— Three.js 球面映射
- 修改文件: `ImageEditModal.tsx`

### 7.13 节点调整大小（所有节点类型）✅
- 参考项目: 所有节点都有 `resize-handle`
- 说明: 当前只有 comfy 和 output 节点有 resize-handle，参考项目所有节点都可调整大小
- 修改文件: `CanvasNode.tsx` — 为所有节点类型添加 resize-handle

### 7.14 图片节点悬浮操作按钮 ✅
- 参考项目: `floating-node-actions`
- 说明: 图片节点悬浮时显示的操作按钮组
- 功能清单:
  - [x] 预览按钮
  - [x] 编辑按钮
  - [x] 下载按钮
  - [x] 替换按钮
- 修改文件: `CanvasNode.tsx` ImageNodeBody

### 7.15 图片分辨率徽章 ✅
- 参考项目: `image-resolution-badge`
- 说明: 在图片节点上显示图片分辨率信息
- 修改文件: `CanvasNode.tsx` ImageNodeBody

### 7.16 提示词节点增强功能 ✅
- 参考项目: `prompt-toolbar` / `prompt-counter` / `prompt-template-btn`
- 说明: 提示词节点工具栏需要更多功能
- 功能清单:
  - [x] 字数统计位置调整到工具栏
  - [x] LLM 生成切换（prompt-llm-toggle）
  - [x] LLM 模式面板（prompt-node-llm）— 模型选择/系统提示词/指令/运行
  - [x] 提示词工具按钮组（prompt-node-tools / prompt-node-pill）
- 修改文件: `CanvasNode.tsx` PromptNodeBody

### 7.17 Loop 节点完整 UI ✅
- 参考项目: `loop-smart-card` / `loop-smart-count` / `loop-smart-seg` / `loop-smart-panel`
- 说明: 当前 Loop 节点只有一个简单 textarea，需要完整 UI
- 功能清单:
  - [x] 循环次数控制（loop-smart-count）
  - [x] 并行/串行模式切换（loop-smart-seg）
  - [x] 提示词变体开关（loop-smart-toggle）
  - [x] 提示词列表面板（loop-smart-prompt-list / loop-smart-prompt-item）
  - [x] 上游提示词预览（loop-smart-upstream）
  - [x] 添加提示词按钮（loop-smart-add-prompt）
  - [x] 提示词编号标签（loop-smart-prompt-index）
  - [x] 提示词删除按钮（loop-smart-icon-btn）
- 修改文件: `CanvasNode.tsx` LoopNodeBody

### 7.18 生成器节点级联按钮 ✅
- 参考项目: `gen-cascade-btn` / `gen-cascade-stop`
- 说明: 生成器节点底部需要级联运行按钮
- 功能清单:
  - [x] 一键运行按钮（gen-cascade-btn）
  - [x] 停止运行按钮（gen-cascade-stop）
  - [x] 运行状态显示
- 修改文件: `CanvasNode.tsx` GeneratorNodeBody

### 7.19 生成器节点动态参数面板 ✅
- 参考项目: `dynamicParams` / `settings`
- 说明: 根据引擎类型动态显示不同参数
- 功能清单:
  - [x] API 图片模式 — Provider/Model/比例/分辨率/质量/数量
  - [x] API 视频模式 — 视频Provider/Model/时长/比例/增强
  - [x] ModelScope 模式 — MS模型/LoRA配置
  - [x] ComfyUI 模式 — 工作流/参数
  - [x] RunningHub 模式 — 工作流/付费/实例
  - [x] 自定义尺寸输入（customWidth / customHeight）
  - [x] 自定义比例输入（customRatioWidth / customRatioHeight）
- 修改文件: `CanvasNode.tsx` GeneratorNodeBody

### 7.20 画布视图状态持久化 ✅
- 参考项目: `CANVAS_SESSION_VIEWPORTS_KEY` / `saveLocalViewport`
- 说明: 每个画布的视口位置应独立保存，切换画布时恢复
- 修改文件: `use-canvas-store.ts`

### 7.21 画布远程同步 ✅
- 参考项目: `remoteSyncTimer` / `syncRemoteCanvasNow` / `applyingRemoteCanvas`
- 说明: 多标签页/多设备间画布状态同步
- 修改文件: `use-canvas-store.ts`

### 7.22 生成器节点设置记忆 ✅
- 参考项目: `RECENT_SMART_SETTINGS_KEY` / `rememberRecentSmartSettings`
- 说明: 记住每种引擎模式的上次使用设置
- 修改文件: `use-canvas-store.ts`

### 7.23 提示词模板库增强 ✅
- 参考项目: `promptTemplateGroups` / `promptTemplateOverrides` / `promptLibraries`
- 说明: 模板库需要更多管理功能
- 功能清单:
  - [x] 模板分组管理（promptTemplateGroups）
  - [x] 内置模板隐藏/覆盖（promptTemplateOverrides）
  - [x] 多模板库切换（promptLibraries）
  - [x] 模板分类标签筛选
  - [x] 模板编辑模式
- 修改文件: `PromptTemplateModal.tsx`

---

## 八、样式差距（补充）

### 8.1 智能画布样式 ✅
- 参考项目: `smart-canvas.css`（约 1024 行）
- 说明: 智能画布有完全独立的样式系统，需要迁移
- 功能清单:
  - [x] Composer 面板样式（.composer / .composer-card / .composer-head / .prompt-input / .param-row / .dynamic-params / .run-btn / .cascade-run-btn）
  - [x] 智能节点样式（.prompt-smart-node / .loop-smart-node / .prompt-node-card / .prompt-node-text / .loop-smart-card / .loop-smart-panel）
  - [x] 输入缩略图样式（.input-thumbs-row / .smart-node-input-thumbs / .smart-node-input-thumb / .smart-node-input-badge）
  - [x] 浮动操作按钮样式（.floating-node-actions / .mini-x / .node-port / .node-resize-handle）
  - [x] 分辨率徽章样式（.image-resolution-badge）
  - [x] 智能小地图样式（.smart-minimap / .smart-minimap-content / .smart-minimap-viewport）
  - [x] 提示词预设面板样式（.preset-panel / .preset-grid / .preset-item）
  - [x] 提及选择器样式（.mention-picker / .mention-item）
  - [x] 快捷键弹窗样式（.shortcut-modal / .shortcut-panel / .shortcut-list / .shortcut-item / .shortcut-keys）
  - [ ] 日志弹窗样式（.log-modal / .log-panel / .log-list）— 已有基础样式
  - [x] 资产面板样式（.asset-search-row / .asset-category-tabs / .asset-sync-row / .asset-tag）
  - [x] 返回按钮样式（.smart-back / .smart-title）
  - [x] 创建菜单样式（.create-menu / .create-menu-grid / .create-card）
  - [ ] 响应式样式

### 8.2 画布管理面板样式 ✅
- 参考项目: `canvas.css` 中 `.canvas-gate` / `.gate-panel` / `.canvas-item` 等
- 说明: 画布管理面板的完整样式
- 功能清单:
  - [x] 画布卡片样式（.canvas-item / .canvas-open / .canvas-card-title / .canvas-card-meta）
  - [x] 画布类型标签（.canvas-kind-chip）
  - [x] 删除确认样式（.canvas-delete-confirm / .canvas-delete-box）
  - [x] Emoji 选择器样式（.emoji-picker / .emoji-option）
  - [x] 编辑/删除按钮样式（.canvas-card-edit / .canvas-delete）
  - [x] 回收站样式（.trash-note）
  - [x] 新建画布行样式（.gate-create-row）
  - [x] 面板头部样式（.gate-head / .gate-title / .gate-subtitle）

### 8.3 ComfyUI 设置样式 ✅
- 参考项目: `comfyui-settings.css`（约 100+ 行）
- 说明: ComfyUI 工作流编辑器的样式
- 功能清单:
  - [x] 工作流列表样式（.workflow-list / .workflow-card）
  - [ ] 工作流图样式（.graph-card / .graph-svg / .gnode / .gedge）
  - [ ] 节点分类色样式（.cat-prompt / .cat-loader / .cat-sampler 等）
  - [x] 浮窗参数面板样式（.popup-panel / .popup-head / .popup-body）
  - [ ] 上传按钮样式（.upload-btn）

### 8.4 API 设置完整样式 ❌
- 参考项目: `api-settings.css`（约 5259 行）
- 说明: API 设置面板的完整样式远超当前实现
- 功能清单:
  - [ ] Provider 卡片样式（.provider-card / .provider-mark / .provider-name）
  - [ ] 推荐API卡片（.recommend-card / .recommend-name / .recommend-badge / .recommend-tags）
  - [ ] 模型行样式（.model-row / .model-list）
  - [ ] LoRA 配置样式（.lora-row / .lora-field / .lora-list）
  - [ ] Key 输入样式（.key-row / .key-panel / .key-input-line）
  - [ ] 高级端点样式（.advanced-endpoints / .endpoint-grid）
  - [ ] 模型选择器浮层（.picker-overlay / .picker-modal）
  - [ ] 暗色主题完整适配

### 8.5 资产库管理器完整样式 ❌
- 参考项目: `asset-manager.css`（约 270 行）
- 说明: 资产库管理器的完整三栏布局样式
- 功能清单:
  - [ ] 三栏布局（.asset-manager-root — 282px + minmax(420px,1fr) + 360px）
  - [ ] 导航树样式（.nav-tree / .tree-branch / .tree-row / .tree-children）
  - [ ] 内容网格样式（.asset-grid / .asset-card / .upload-grid-card）
  - [ ] 提示词列表样式（.prompt-list / .prompt-row）
  - [ ] 详情面板样式（.detail-scroll）
  - [ ] 搜索框样式（.asset-search-wrap）
  - [ ] 拖放区域样式（.asset-drop / .side-upload-card）
  - [ ] 管理模式工具栏（.manage-tools）
  - [ ] 剪贴板栏（.asset-clipboard-bar）

### 8.6 主题系统完整适配 ❌
- 参考项目: `theme.css`（约 1651 行）
- 说明: 暗色主题的完整适配，当前只覆盖了部分
- 功能清单:
  - [ ] 所有组件的暗色主题变量覆盖
  - [ ] 输入框/选择器暗色适配
  - [ ] 按钮暗色适配
  - [ ] 弹窗暗色适配
  - [ ] 节点暗色适配
  - [ ] 滚动条暗色适配
  - [ ] 全局字体/间距一致性

### 8.7 缺失的节点样式细节 ❌
- 参考项目: `canvas.css` 中各节点类型的详细样式
- 功能清单:
  - [ ] 视频节点样式（.video-node / .video-input-head / .video-input-actions）
  - [ ] LLM 节点对话样式（.llm-chat-log / .llm-bubble / .llm-mode）
  - [ ] 输出节点增强样式（.output-prompt-panel / .output-compare）
  - [ ] 选择集操作栏样式（.selection-hub）
  - [ ] 节点运行状态动画增强
  - [ ] 生成器节点设置行样式（.gen-settings / .setting-row / .setting-title / .setting-input）
  - [ ] 生成器节点模式切换样式（.mode-tabs / .mode-tabs button）
  - [ ] 生成器节点数量步进器样式（.gen-count-row / .gen-count-input / .gen-step-btn）
  - [ ] 生成器节点选择器样式（.select-lite / .seg）
  - [ ] 提示词工具栏样式（.prompt-toolbar / .prompt-template-btn）
  - [ ] 提示词计数器样式（.prompt-counter）
  - [ ] 图片拖拽替换高亮样式（.drag-over）

---

## 九、迁移优先级建议

### P0 — 核心交互（必须先完成）✅
1. ✅ 画布模式切换（6.4）
2. ✅ Composer 智能生成面板（6.1）
3. ✅ 一键运行/级联运行（6.2）
4. ✅ 智能画布节点样式（6.3）

### P1 — 重要功能 ✅
5. ✅ 画布管理面板（7.1）
6. ✅ Loop 节点完整 UI（7.17）
7. ✅ 生成器节点级联按钮（7.18）
8. ✅ 生成器节点动态参数面板（7.19）
9. ✅ LLM 节点对话界面（7.6）
10. ✅ 提示词节点增强功能（7.16）

### P2 — 增强功能 ✅
11. ✅ 多选操作栏（7.2）
12. ✅ 输出 Lightbox 对比模式（7.3）
13. ✅ 输出 Lightbox 提示词面板（7.4）
14. ✅ 节点输入/输出端口菜单（7.5）
15. ✅ 视频节点专用 UI（7.7）
16. ✅ MS Gen 节点专用 UI（7.11）
17. ✅ 提示词预设面板（6.5）
18. ✅ Mention Picker（6.7）

### P3 — 高级功能 ✅
19. ✅ ComfyUI 节点设置面板（7.8）
20. ✅ RunningHub 节点专用 UI（7.9）
21. ✅ LTX Director 节点时间线（7.10）
22. ✅ 图片编辑器完整功能（7.12）
23. ✅ 画布远程同步（7.21）
24. ✅ 智能画布资产面板差异（6.8）

### P4 — 样式完善（已完成）
25. ✅ 智能画布样式（8.1）
26. ✅ 画布管理面板样式（8.2）
27. ✅ ComfyUI 设置样式（8.3）
28. ✅ API 设置完整样式（8.4）
29. ✅ 资产库管理器完整样式（8.5）
30. ✅ 主题系统完整适配（8.6）
31. ✅ 缺失的节点样式细节（8.7）

---

## 文件清单

| 文件 | 说明 |
|------|------|
| InfiniteCanvas.tsx | 主画布组件，集成所有交互和弹窗 |
| CanvasNode.tsx | 节点渲染（Image/Prompt/Output/Generator/Group/Loop 等12种） |
| CanvasLinks.tsx | 连接线渲染 |
| CanvasMiniMap.tsx | 小地图 |
| CanvasToolbar.tsx | 工具栏（撤销/Knife/适应/分组/资产库/管理/API/主题） |
| ZoomControls.tsx | 缩放控制 |
| CreateMenu.tsx | 双击创建菜单 |
| OutputLightbox.tsx | 图片预览 Lightbox |
| ImageNodeMenu.tsx | 图片节点右键菜单 |
| LinkCreateMenu.tsx | 连接线创建菜单 |
| GeneratorNodeMenu.tsx | 生成器节点右键菜单 |
| PromptTemplateModal.tsx | 提示词模板库弹窗 |
| CanvasAssetPanel.tsx | 资产库侧边面板 |
| AssetManagerModal.tsx | 资产库管理器弹窗 |
| ImageEditModal.tsx | 图片编辑器弹窗 |
| ApiSettingsModal.tsx | API 设置面板 |
| ErrorModal.tsx | 错误弹窗 |
| CanvasLogModal.tsx | 日志面板 |
| use-canvas-store.ts | Zustand 状态管理 + localStorage 持久化 |
| types.ts | 类型定义 |
| engine.ts | 画布引擎工具函数 |
| theme.ts | 主题系统 |
| canvas.css | 全部样式 |
| index.ts | 导出入口 |

### 待新建文件

| 文件 | 说明 | 状态 |
|------|------|------|
| ComposerPanel.tsx | 智能画布 Composer 生成面板 | ✅ 已创建 |
| CanvasGate.tsx | 画布管理面板（列表/新建/删除） | ✅ 已创建 |
| LightboxPanel.tsx | 图片预览对比面板 | ✅ 已创建 |
| PromptPresets.tsx | 提示词预设 + Mention Picker | ✅ 已创建 |
| ComfyUISettingsPanel.tsx | ComfyUI 工作流设置面板 | — 已集成到 CanvasNode |
| LTXTimeline.tsx | LTX Director 时间线组件 | — 已集成到 CanvasNode |
| PortMenu.tsx | 端口右键菜单 | — 已集成到 CanvasNode |
