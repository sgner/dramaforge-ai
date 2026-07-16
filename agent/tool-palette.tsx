/**
 * ToolPalette — 展示 agent 可用的工具（按 6 类分组） + 当前任务中已被调用的工具列表。
 *
 * 数据源：硬编码（与 backend/app/agent/tools/__init__.py:ALL_TOOLS 一一对应）。
 * 后续可改为拉取 /api/agent/tools。
 *
 * 增强：
 *   - 接收 `actions` 数组，显示每个工具被调用的次数和最近一次结果
 *   - 等待审核的工具（requiresApproval）会高亮，并显示"等待审核"标记
 */
import React, { useMemo } from 'react';
import { CheckCircle2, Clock, AlertCircle } from 'lucide-react';
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
  { name: 'generate_media_batch', description: '并行生成图片和视频，单项失败不影响其他任务', category: 'image', requiresApproval: true },
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

export interface ToolCallStat {
  name: string;
  count: number;
  lastStatus: 'ok' | 'pending' | 'error';
  lastTs: number;
}

export const ToolPalette: React.FC<{
  tools?: PaletteTool[];
  /**
   * 当前任务的 action 事件数组（来自 useAgentStore.actions）。
   * 用于统计每个工具被调用了几次、最近一次结果。
   */
  actions?: any[];
}> = ({ tools, actions }) => {
  const data = tools ?? PALETTE_TOOLS;

  // 统计每个工具的调用情况
  const stats = useMemo(() => {
    const map = new Map<string, ToolCallStat>();
    for (const a of actions || []) {
      const name = a?.payload?.tool;
      if (!name) continue;
      const cur = map.get(name) || { name, count: 0, lastStatus: 'pending' as const, lastTs: 0 };
      cur.count += 1;
      const r = a?.payload?.result;
      if (r && typeof r === 'object' && 'ok' in r) {
        cur.lastStatus = r.ok ? 'ok' : 'error';
      }
      cur.lastTs = Math.max(cur.lastTs, a?.timestamp || 0);
      map.set(name, cur);
    }
    return map;
  }, [actions]);

  const byCat = CATEGORIES.map((c) => ({
    category: c,
    tools: data.filter((t) => t.category === c),
  }));

  return (
    <div className="tool-palette" data-testid="tool-palette">
      {byCat.map(({ category, tools }) => {
        const called = tools.filter(t => stats.has(t.name));
        return (
          <div
            key={category}
            data-testid={`tool-palette-category-${category}`}
            className="tool-palette-category"
          >
            <div className="tool-palette-category-head">
              <span>{CATEGORY_LABELS[category]}</span>
              <span className="tool-palette-category-count">
                {called.length > 0 ? `${called.length}/${tools.length}` : tools.length}
              </span>
            </div>
            <div className="tool-palette-list">
              {tools.map((t) => {
                const s = stats.get(t.name);
                return (
                  <div
                    key={t.name}
                    className={`tool-palette-item ${s ? 'is-called' : ''} ${s?.lastStatus === 'error' ? 'is-error' : ''}`}
                    data-testid="tool-palette-item"
                    title={s ? `已调用 ${s.count} 次` : '尚未调用'}
                  >
                    <div className="tool-palette-item-body">
                      <div className="tool-palette-item-name">
                        {s && (
                          <span className={`tool-palette-item-status ${s.lastStatus}`}>
                            {s.lastStatus === 'ok' && <CheckCircle2 size={10} />}
                            {s.lastStatus === 'error' && <AlertCircle size={10} />}
                            {s.lastStatus === 'pending' && <Clock size={10} />}
                          </span>
                        )}
                        {t.name}
                      </div>
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
                    {s && (
                      <span className="tool-palette-count">×{s.count}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ToolPalette;
