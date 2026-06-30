# 参考项目智能画布结构拆解

## 1. HTML 结构 (smart-canvas.html)

### shell/world 布局
```
#shell.shell
  #world.world
    #composer.composer
      .composer-card
        .composer-head
          .composer-head-left
            #engineSelect.engine-select
            #apiKindToggle.kind-toggle
        #inputThumbsRow.input-thumbs-row
        #inputPromptPreview.input-prompt-preview
        .prompt-row
          #promptInput.prompt-input (contenteditable)
          #composerTemplateBtn.composer-template-btn
          #mentionPicker.mention-picker
          #promptResize.prompt-resize
        .param-row
          #dynamicParams.dynamic-params
        .composer-actions
          #cascadeRunBtn.run-btn.cascade-run-btn
          #runBtn.run-btn
    (nodes rendered by JS into #world)
  button.smart-back
  #smartTitle.smart-title
  #createMenu.create-menu
    .create-menu-grid
      button.create-card[data-create-type="image"] (上传节点)
      button.create-card[data-create-type="prompt"] (提示词)
      button.create-card[data-create-type="loop"] (循环节点)
  #fileInput (hidden)
  #promptPresetPanel.prompt-preset-panel
  #promptTemplatePanel.prompt-template-panel
  #minimap.smart-minimap
  button#smartShortcutToggle
  button#smartLogToggle
  button#assetToggle.asset-toggle
  aside#assetPanel.asset-panel
  #assetDialogBackdrop
  #assetHoverPreview
  #selectionBox.selection-box
  #smartLogModal.log-modal
  #smartShortcutModal.shortcut-modal
  #imageEditModal.image-edit-modal
```

## 2. CSS 结构 (smart-canvas.css)

### 核心布局
- `.shell` - 全屏画布容器，带网格背景
- `.world` - 6000x4000 世界坐标空间
- `.smart-back` - 返回按钮（左上角）
- `.smart-title` - 画布标题

### 节点样式
- `.image-node` - 基础节点（所有节点共用）
- `.image-node.empty-node` - 空上传节点
- `.image-node.group-node` - 分组节点
- `.image-node.prompt-smart-node` - 提示词节点
- `.image-node.loop-smart-node` - 循环节点
- `.image-node.selected` - 选中状态
- `.node-head` - 节点头部（透明拖拽覆盖层）
- `.node-body` - 节点内容区
- `.node-port` - 连接端口
- `.node-resize-handle` - 缩放手柄
- `.floating-node-actions` - 悬浮操作按钮
- `.mini-x` - 删除按钮

### 提示词节点内部
- `.prompt-node-card` - 提示词卡片
- `.prompt-node-text` - 文本编辑区
- `.prompt-node-tools` - 工具栏
- `.prompt-node-pill` - 小药丸按钮
- `.prompt-llm-toggle` - LLM开关
- `.prompt-node-llm` - LLM配置区
- `.prompt-node-run` - 运行按钮

### 循环节点内部
- `.loop-node-placeholder` - 占位符
- `.loop-smart-card` - 循环卡片
- `.loop-smart-row` - 行布局
- `.loop-smart-count` - 计数器
- `.loop-smart-seg` - 分段控制
- `.loop-smart-toggle` - 开关
- `.loop-smart-panel` - 面板
- `.loop-smart-text` - 文本编辑
- `.loop-smart-prompt-list` - 提示词列表
- `.loop-smart-prompt-item` - 提示词项

### Composer 面板
- `.composer` - 面板容器
- `.composer-card` - 卡片布局
- `.composer-head` - 头部
- `.engine-select` - 引擎选择
- `.kind-toggle` - 图片/视频切换
- `.input-thumbs-row` - 输入缩略图行
- `.prompt-input` - 提示词输入
- `.dynamic-params` - 动态参数区
- `.param-row` - 参数行
- `.run-btn` - 运行按钮
- `.cascade-run-btn` - 级联运行按钮
- `.smart-control` - 参数控件
- `.smart-pill` - 药丸按钮
- `.smart-popover` - 弹出选择器

### 创建菜单
- `.create-menu` - 创建菜单
- `.create-menu-grid` - 网格布局
- `.create-card` - 创建卡片

### 资产面板
- `.asset-toggle` - 资产库切换按钮
- `.asset-panel` - 资产面板
- `.asset-grid` - 资产网格

### 迷你地图
- `.smart-minimap` - 迷你地图
- `.smart-minimap-content` - 内容
- `.smart-minimap-viewport` - 视口

### 连接线
- `svg.connection-layer` - SVG连接层
- `.conn-pending` - 等待状态
- `.conn-cascade` - 级联状态
- `.conn-history` - 历史连接
- `.conn-cut` - 切断按钮

## 3. JS 逻辑结构 (smart-canvas.js, ~12000行)

### 核心模块划分

#### 3.1 状态管理 (lines 1-200)
- 全局变量：nodes, selectedId, viewport, settings, canvas
- 画布加载/保存：loadCanvas(), saveCanvas(), scheduleSave()
- 撤销系统：undoStack, pushUndo(), performUndo()

#### 3.2 节点类型与布局 (lines 200-500)
- isSmartImageNode() - 判断图片节点
- imageLayout() - 图片布局计算
- promptNodeLayoutSize() - 提示词节点尺寸
- smartLoopWidth/Height() - 循环节点尺寸
- EMPTY_UPLOAD_NODE_WIDTH/HEIGHT - 空节点默认尺寸

#### 3.3 节点创建与渲染 (lines 4000-5000)
- createImageNodeAt() - 创建图片节点
- createPromptNodeAt() - 创建提示词节点
- createLoopNodeAt() - 创建循环节点
- render() - 主渲染函数
- renderNode() - 单节点渲染
- renderConnections() - 连接线渲染

#### 3.4 画布交互 (lines 5000-6000)
- shell.ondblclick - 双击创建菜单
- shell.onmousedown - 画布平移/节点拖拽/框选
- shell.onwheel - 缩放
- selectNode() - 节点选择
- dragState - 拖拽状态管理

#### 3.5 Composer 面板 (lines 1000-2000)
- openComposerAtNode() - 打开Composer
- closeComposer() - 关闭Composer
- positionComposerForNode() - 定位Composer
- renderDynamicParams() - 动态参数渲染
- renderApiParams() - API参数
- renderVolcengineParams() - 火山引擎参数
- renderMsParams() - ModelScope参数
- renderComfyParams() - ComfyUI参数
- renderRunningHubParams() - RunningHub参数

#### 3.6 连接管理 (lines 4000-4200)
- connectInputNode() - 连接节点
- disconnectConnection() - 断开连接
- addConnection() - 添加连接
- inputNodesFor() - 获取输入节点
- downstreamNodesForId() - 获取下游节点

#### 3.7 级联运行 (lines 9000-10000)
- runSmartCascadeFromLoop() - 从循环节点运行级联
- requestSmartCascadeStop() - 停止级联
- smartCascadeGraphForTail() - 构建级联图
- createPendingOutputFromSource() - 创建待处理输出

#### 3.8 提示词模板 (lines 3000-4000)
- promptTemplateItems() - 获取模板列表
- renderPromptTemplatePanel() - 渲染模板面板
- applyPromptTemplateToNode() - 应用模板
- saveCurrentPromptAsTemplate() - 保存模板

#### 3.9 资产库 (lines 3500-4000)
- loadAssetLibrary() - 加载资产库
- renderAssetLibrary() - 渲染资产库
- assetCategories() - 获取分类

#### 3.10 图片编辑 (lines 6000-8000)
- openImageEditModal() - 打开编辑
- setImageEditMode() - 设置编辑模式
- crop/mask/brush/grid/outpaint 各模式

## 4. 与当前项目的关键差异

### 4.1 布局结构
- 参考：shell/world 直接嵌套，composer 在 world 内部
- 当前：canvas-root > canvas-board > canvas-world，composer 是独立组件

### 4.2 节点渲染
- 参考：JS直接操作DOM，innerHTML渲染节点
- 当前：React组件化渲染

### 4.3 Composer面板
- 参考：跟随选中节点定位，在world内部
- 当前：独立浮动面板

### 4.4 创建菜单
- 参考：双击空白处弹出，3个选项（上传/提示词/循环）
- 当前：CreateMenu组件

### 4.5 节点类型
- 参考核心类型：smart-image, smart-prompt, smart-loop
- 当前类型：image, prompt, loop, group, promptGroup, generator, msgen, video, llm, comfy, rh, ltxDirector, output
