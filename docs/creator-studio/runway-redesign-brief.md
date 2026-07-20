# DramaForge × Runway — UI 重构设计规范

> 目标：以 Runway 的三张参考图为设计目标，对全站 UI 做完全重构。
> 图1 = Runway 仪表盘（暗色侧边栏 + 资产库网格）；图2 = 工作室剪辑台（最高优先级）；图3 = 生成会话页。
> 硬性约束：保留全部功能与 `data-testid` 钩子（改名需同步改测试）；新增 `t('key')` 必须在 locales.ts 四个语言块(en/zh/ja/ko)全部补齐（i18n parity 测试为静态扫描）。

---

## 1. 设计令牌（Design Tokens）

全局暗色，参照 Runway：

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#0A0A0B` | 页面底 |
| `--surface` | `#131316` | 面板/卡片底 |
| `--surface-2` | `#1A1A1F` | 悬浮/输入/hover 底 |
| `--border` | `rgba(255,255,255,0.07)` | 分隔线、描边 |
| `--text` | `#F5F5F7` | 主文本 |
| `--text-muted` | `rgba(255,255,255,0.45)` | 次文本 |
| `--accent` | `#6E6BF2` | 主强调（Runway 蓝紫），hover `#817FF5` |
| `--accent-soft` | `rgba(110,107,242,0.14)` | 选中底 |
| `--success` `#3ECF8E` / `--warning` `#F5B544` / `--danger` `#F26161` | 语义色 |

- 圆角：卡片 12px，面板 10px，按钮/徽章胶囊圆角；阴影极少，靠明度差分区。
- 字体：Inter（已有 Google Fonts）；数字/时间码用 JetBrains Mono。
- Tailwind 为 Play CDN，主题色在 `index.html` 的 `window.tailwind.config` 内扩展：`colors.ink`（页面）、`colors.panel`、`colors.line`、`colors.accent` 替换现有反相 brand 用法——**保留 brand-* 名称映射到新暗色值**可减少改动面，但新增 UI 直接用新 token。
- 时间线轨道配色（图2）：视频轨 `#8B7CF6`、图像/素材 `#E8738C`、字幕/文本 `#E5C77E`、音频 `#4CC38A`、AI 层 `#F2A65A`。

## 2. 应用外壳（对应图1）

- 整体 `min-h-screen bg-[#0A0A0B] text-[#F5F5F7]`，移除径向浅底装饰。
- **左侧固定侧边栏** w-60：
  - 顶部工作区卡：项目 logo 方块（accent 渐变）+ 名称 + 副标题。
  - 导航分组：概览（首页/项目）；创作（智能画布、Agent、提示词库等入口按现有功能映射）；资源（素材车间、工作室入口）。分组小标题 11px muted。
  - 底部：设置、语言切换（沿用现有逻辑）、用量/计划占位卡。
- **顶栏**（内容区上方）：左侧搜索框（`搜索项目与素材` 占位，样式如图1圆角输入），右侧帮助 `?`、头像圆点。仅列表页显示；画布/工作室为全屏自有 chrome（沿用现状）。
- 保留：`agent-background-banner`、`global-sse-banner`（fixed pill，样式改暗色 glass）、toast 堆叠、celebration 覆盖层（改暗色）。

## 3. 首页 / 项目列表（对应图1 Assets 页）

- 页头：大标题（28px 600）+ Private/Shared 式 tab 下划线（可映射为 全部/进行中/已完成 或保持单 tab）。
- 右上动作：`导入`、`导出`（幽灵按钮，surface-2 底）+ `新建项目`（accent 实心胶囊，可带 ▾）。
- 项目卡（TaskCard）：surface 底 + 1px border，16:9 封面，hover 浮起 + 显示"去工作室成片"（accent 胶囊）；状态徽章改为暗色语义色点 + 文字；进度条细 3px accent。
- 空状态：居中插画位 + 标题 + accent 新建按钮（去掉现有浅色 hero 大动画；PipelineStream 如保留则放进小号卡片）。
- **保留文案 `素材车间` 或同步更新 `tests/app-studio-entry.test.tsx`。**

## 4. 工作室（最高优先级，对应图2）

布局（全屏 overlay，替换现有 StudioPanel 的三段式舞台导航为**单页工作台**；阶段切换可保留为顶部小 tab 或左栏入口，但剪辑台必须是图2形态）：

```
┌────────────────────────────────────────────────────────────┐
│ 顶栏 h-12: ☰ logo 工作室 | 项目名   ⋯⟳ 33%   头像 分享 导出 │
├────┬──────────┬──────────────────────┬─────────────────────┤
│图标│ 素材箱    │   Program Monitor     │  Inspector          │
│栏48│ (可折叠    │   黑底 16:9 + 浮动    │  Transform/         │
│ px │  ~240px)  │   播放胶囊            │  Effects/Audio 分区 │
├────┴──────────┴──────────────────────┴─────────────────────┤
│ 走带栏 h-11: ▶ ⏮ 00:03/15:00 ⏭  速度  Split  Fit  ⚙        │
├────────────────────────────────────────────────────────────┤
│ 时间线 h-52: 标尺 + V1/V2/A1/字幕 多轨，彩色 clip 块，红色    │
│ 播放头（竖线 + 顶部圆点）                                      │
└────────────────────────────────────────────────────────────┘
```

- **左图标栏**（新增，48px）：Upload / Assets / Text / 帮助 图标纵列，active = accent 底圆角块；点击 Assets 切换素材箱折叠（复用现有 `studio-bin-expand` 逻辑，testid 保留）。
- **素材箱**：顶部搜索框 + 过滤图标；"Recent" 列表——缩略图 44px 圆角 + 名称 + 时长/时间，上传/导出进度百分比行；类型 chips 保留；点击追加 2s clip（现有行为不变）。
- **Program Monitor**：纯黑视口，底部浮动 glass 胶囊（⏮ ▶ ⏭ + mono 时间码），右上缩放指示。
- **Inspector**（右侧 280px）：分区块标题 12px muted，每区可折叠：Transform（Position/Size/Rotation 数值输入双列）、选中片段信息（沿用现有 clip 编辑：缩略图/时长/上下移/删除）、Audio（Volume 滑条）、底部导出区（Smart Arrange + 导出剧集 accent 按钮）。现有 testid 全部保留。
- **走带栏**：独立一行（现浮动胶囊改为底栏内嵌），左播放控制 + 时间码，中部播放速度，右侧 Split/Fit/设置；`studio-play-btn` 等 testid 不变。
- **时间线**：多轨视觉——V1 视频（紫）、素材/图像（粉）、字幕（黄）、A1 音频（绿）色块；clip 选中 accent 描边；右缘拖拽改时长（0.5s 步进、1-15s 钳制不变）；红色播放头贯穿；缩放滑条保留 `studio-tl-zoom`。
- 配色从 Apple HIG（#0A84FF）**整体切换到 §1 accent 蓝紫**，`studio/theme.ts` 常量同步更新；径向顶光减弱。

## 5. 生成会话页（对应图3）

- 新建项目 / 项目入口页采用左右分栏：左面板 w-96——顶部 Image/Video 分段控件、大文本域（placeholder 描述镜头）、References 区（素材/上传按钮）、底部参数条（比例 16:9、数量、1080p）+ accent Generate 大按钮；右侧——欢迎标题 + 主预览区 + 缩略图横排。
- 实现路径：重构 App.tsx 内联"新建项目"弹窗为**整页会话视图**或保留弹窗但按此风格；若工程量大，可将 `NewTaskModal`（现死代码）复活为会话式创建页。文案沿用现有 `newProject/projectNamePlaceholder` 等 key，少加新 key。

## 6. 弹窗与共享组件

- 全部弹窗：`bg-[#131316] border border-white/[0.07] rounded-2xl`，遮罩 `bg-black/60 backdrop-blur-sm`，标题 15px 600，输入框 `bg-white/[0.06]` 无边框 focus ring accent/40，主按钮 accent 胶囊、次按钮 surface-2。
- 涉及：ConfirmModal、EditCharacterModal、BigShotDetailModal（全屏编辑也走暗色）、ImageLightbox、ApiSettingsModal（canvas.css 内样式，量力改）、SensitiveFilterReport。

## 7. 画布与 Agent（对齐即可，不重写）

- `canvas.css` 7095 行不重写：将 `use-canvas-store` 默认 theme 改为 `'dark'`，并把 `.canvas-root.theme-dark` 的 `--page/--card/--accent` 等变量值对齐 §1（`--page:#0A0A0B`、`--accent:#6E6BF2`）；顶栏 pill 沿用。
- agent 界面同理，仅调变量。
- `global-agent-banners.css` 变量兜底值改暗色，fixed pill 位置避开新顶栏。

## 8. 测试与验收

- `npm run build` 通过；`npm test` 全绿（可更新断言文案/结构，但不得删功能断言；testid 一律保留）。
- `tests/source-no-mojibake.test.ts`：编辑中文文件注意编码。
- 验收截图：首页（侧边栏+卡片网格）、工作室（图2五区布局）、新建项目会话、弹窗。

## 9. 不做的事

- 不改后端、不改数据流/props 契约、不删 CanvasGate（有测试）、不重写 canvas.css/agent.css 全部样式、不引入 react-router（沿用状态切换）。
