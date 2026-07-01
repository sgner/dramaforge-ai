/**
 * ToolPalette — 展示 agent 可用的工具（按 6 类分组）。
 *
 * 数据源：硬编码（与 backend/app/agent/tools/__init__.py:ALL_TOOLS 一一对应）。
 * 后续可改为拉取 /api/agent/tools。
 */
import React from 'react';
import './agent.css';

export interface PaletteTool {
  name: string;
  description: string;
  category: 'planning' | 'llm' | 'image' | 'video' | 'audio' | 'asset';
  requiresApproval: boolean;
}

export const PALETTE_TOOLS: PaletteTool[] = [
  // planning (3)
  { name: 'parse_user_goal', description: '解析用户目标，提取主题/角色/风格', category: 'planning', requiresApproval: false },
  { name: 'create_plan', description: '生成执行计划（步骤列表）', category: 'planning', requiresApproval: false },
  { name: 'ask_user', description: '向用户提问获取关键信息', category: 'planning', requiresApproval: false },
  // llm (6)
  { name: 'generate_script', description: '生成剧本/小说文本', category: 'llm', requiresApproval: false },
  { name: 'extract_characters', description: '从剧本提取角色列表', category: 'llm', requiresApproval: false },
  { name: 'extract_props', description: '从剧本提取道具列表', category: 'llm', requiresApproval: false },
  { name: 'extract_scenes', description: '从剧本提取场景列表', category: 'llm', requiresApproval: false },
  { name: 'extract_shots', description: '从剧本提取分镜列表', category: 'llm', requiresApproval: false },
  { name: 'optimize_prompt', description: '优化图像/视频 prompt', category: 'llm', requiresApproval: false },
  // image (4)
  { name: 'generate_character_portrait', description: '生成角色三视图', category: 'image', requiresApproval: true },
  { name: 'generate_prop_image', description: '生成道具图', category: 'image', requiresApproval: true },
  { name: 'generate_scene_image', description: '生成场景概念图', category: 'image', requiresApproval: true },
  { name: 'generate_storyboard_image', description: '生成分镜首帧', category: 'image', requiresApproval: true },
  // video (1)
  { name: 'generate_video', description: '基于分镜生成视频片段', category: 'video', requiresApproval: true },
  // audio (2)
  { name: 'generate_voiceover', description: '文本转语音', category: 'audio', requiresApproval: true },
  { name: 'generate_bgm', description: '生成背景音乐', category: 'audio', requiresApproval: true },
  // asset (2)
  { name: 'save_asset', description: '保存资产到资产库', category: 'asset', requiresApproval: false },
  { name: 'get_artifacts', description: '查询已生成的资产', category: 'asset', requiresApproval: false },
];

const CATEGORIES: PaletteTool['category'][] = ['planning', 'llm', 'image', 'video', 'audio', 'asset'];

const CATEGORY_LABELS: Record<PaletteTool['category'], string> = {
  planning: '规划',
  llm: '文本生成',
  image: '图像',
  video: '视频',
  audio: '音频',
  asset: '资产',
};

export const ToolPalette: React.FC<{ tools?: PaletteTool[] }> = ({ tools }) => {
  const data = tools ?? PALETTE_TOOLS;
  const byCat = CATEGORIES.map((c) => ({
    category: c,
    tools: data.filter((t) => t.category === c),
  }));

  return (
    <div className="tool-palette" data-testid="tool-palette">
      {byCat.map(({ category, tools }) => (
        <div
          key={category}
          data-testid={`tool-palette-category-${category}`}
          className="tool-palette-category"
        >
          <div className="tool-palette-category-head">
            <span>{CATEGORY_LABELS[category]}</span>
            <span className="tool-palette-category-count">{tools.length}</span>
          </div>
          <div className="tool-palette-list">
            {tools.map((t) => (
              <div key={t.name} className="tool-palette-item" data-testid="tool-palette-item">
                <div className="tool-palette-item-body">
                  <div className="tool-palette-item-name">{t.name}</div>
                  <div className="tool-palette-item-desc">{t.description}</div>
                </div>
                {t.requiresApproval && (
                  <span
                    data-testid="tool-palette-requires-approval"
                    className="tool-palette-badge requires"
                    title="需用户审核"
                  >
                    需审核
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
