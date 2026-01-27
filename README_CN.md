# DramaForge AI

<div align="center">

**一站式 AI 短剧制作平台**

集成 Gemini、Nanobanana 和 Sora 2，实现从脚本到视频的自动化生成

[![React](https://img.shields.io/badge/React-19.2.3-blue.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-purple.svg)](https://vitejs.dev/)

</div>

## 功能特性

- **脚本生成**：使用 Google Gemini AI 从小说或创意想法生成专业短剧脚本
- **角色设计**：使用 Nanobanana API 创建详细的角色参考图（三视图设计）
- **分镜制作**：为每个场景生成 6 格分镜图
- **视频生成**：使用 Sora 2 API 制作高质量视频
- **多种艺术风格**：动画（2D）、电影写实、赛博朋克、水彩、3D 卡通
- **多语言支持**：中文（简体）、英语、日语、韩语
- **双模式操作**：
  - 自动模式：从输入到视频的全自动化流程
  - 手动模式：逐步控制，支持编辑功能
- **实时进度跟踪**：监控每个阶段的生成状态
- **交互式编辑**：修改提示词、重新生成场景、调整角色分配

## 图片画廊

### 界面展示

<div align="center">

| 主界面 | 任务卡片 | 角色编辑 |
|:---:|:---:|:---:|
| ![主界面](./screenshots/main-interface.png) | ![任务卡片](./screenshots/task-card.png) | ![角色编辑](./screenshots/character-edit.png) |

</div>

### 生成效果展示

<div align="center">

| 角色设计 | 分镜制作 | 视频生成 |
|:---:|:---:|:---:|
| ![角色设计](./screenshots/character-design.png) | ![分镜制作](./screenshots/storyboard.png) | ![视频生成](./screenshots/video-generation.png) |

</div>

### 流程演示

<div align="center">

| 脚本生成 | 提示词优化 | 最终效果 |
|:---:|:---:|:---:|
| ![脚本生成](./screenshots/script-generation.png) | ![提示词优化](./screenshots/prompt-optimization.png) | ![最终效果](./screenshots/final-result.png) |

</div>

## 技术栈

- **前端框架**：React 19.2.3 + TypeScript
- **构建工具**：Vite 6.2
- **AI 服务**：
  - Google Gemini 3 Pro（脚本生成与优化）
  - Nanobanana API（角色设计与分镜生成）
  - Sora 2 API（视频生成）
- **HTTP 客户端**：Axios
- **图标库**：Lucide React

## 安装

**前置要求**：Node.js（推荐 v18 或更高版本）

1. 克隆仓库：
   ```bash
   git clone https://github.com/yourusername/dramaforge-ai.git
   cd dramaforge-ai
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 配置 API 密钥：
   - 启动应用并点击 API 密钥配置按钮
   - 输入您的 API 密钥：
     - Google Gemini API
     - Nanobanana API
     - Sora API
   - 如果使用代理服务，可选择配置自定义基础 URL

4. 运行开发服务器：
   ```bash
   npm run dev
   ```

5. 在浏览器中打开 `http://localhost:5173`

## 使用指南

### 创建新任务

1. 点击"新建任务"按钮
2. 选择输入类型：
   - **小说**：粘贴小说文本
   - **创意**：输入创意想法（将扩展为完整故事）
3. 选择艺术风格和语言
4. 选择模式（自动或手动）
5. 点击"创建"开始生成流程

### 流程阶段

应用遵循以下逻辑步骤：

1. **预处理**：分段和分析输入文本
2. **脚本生成**：将文本转换为结构化脚本场景
3. **角色设计**：生成角色参考图
4. **分镜制作**：为每个场景创建 6 格分镜
5. **提示词优化**：优化 Sora 视频生成的提示词
6. **视频生成**：为每个场景制作最终视频
7. **完成**：所有资源准备就绪，可导出

### 手动模式功能

在手动模式下，您可以：
- 编辑角色信息并重新生成设计
- 修改分镜提示词并重新生成图像
- 调整 Sora 提示词并重新生成视频
- 为特定场景分配角色
- 下载单个资源（图像、视频）

### 导出功能

- 将分镜下载为 PNG 图像
- 将视频下载为 MP4 文件
- 导出角色设计图

## 项目结构

```
dramaforge-ai/
├── components/           # React 组件
│   ├── ApiKeyModal.tsx
│   ├── ConfirmModal.tsx
│   ├── EditCharacterModal.tsx
│   ├── ImageLightbox.tsx
│   ├── NewTaskModal.tsx
│   └── TaskCard.tsx
├── services/           # API 服务层
│   ├── geminiService.ts      # Gemini AI 集成
│   ├── mediaService.ts       # Nanobanana & Sora 集成
│   └── mockExternalServices.ts
├── App.tsx             # 主应用组件
├── types.ts            # TypeScript 类型定义
├── constants.ts        # 常量和提示词
├── locales.ts          # 国际化
├── index.html
├── index.tsx
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## API 配置

### Gemini API
- 模型：`gemini-3-pro-preview`
- 用途：脚本生成、提示词优化、故事扩展、预处理
- 获取 API 密钥：https://ai.google.dev/

### Nanobanana API
- 用途：角色设计生成、分镜生成
- 支持：文本生成图像和图像生成图像
- 获取 API 密钥：https://nanobanana.com/

### Sora API
- 用途：最终视频生成
- 获取 API 密钥：https://openai.com/sora

## 开发

### 可用脚本

```bash
npm run dev      # 启动开发服务器
npm run build    # 构建生产版本
npm run preview  # 预览生产构建
```

### 生产构建

```bash
npm run build
```

构建文件将位于 `dist` 目录中。

## 功能详情

### 脚本生成
- 将小说或想法转换为包含对话、动作和情绪的结构化脚本
- 分析情节、氛围和角色关系
- 支持长文本自动分段

### 角色设计
- 生成三视图角色表（正面、侧面、背面）
- 支持从用户上传的参考图进行图像生成图像
- 跨场景保持角色外观一致性

### 分镜制作
- 为每个场景创建 6 格分镜
- 可视化镜头角度、角色位置和环境
- 可编辑提示词用于重新生成

### 视频生成
- 使用优化的提示词以获得最佳效果
- 实时进度跟踪
- 失败重试机制

## 浏览器支持

- Chrome/Edge（推荐）
- Firefox
- Safari

## 许可证

本项目为私有和专有项目。

## 贡献

这是一个私有项目。如有疑问，请联系项目维护者。

## 致谢

- Google Gemini AI 提供脚本生成能力
- Nanobanana API 提供图像生成服务
- Sora API 提供视频生成
- Lucide React 提供精美图标
