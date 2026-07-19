/**
 * ThoughtStream — 侧栏流式展示 agent 的 thoughts/actions/observations。
 *
 * 设计：3 个分区按时间顺序堆叠，最新的 thought 顶部高亮；
 * 通过 data-testid 暴露给测试。
 *
 * 支持两种模式：
 * 1. 默认（侧栏）：直接渲染 ThoughtStreamBody
 * 2. floating 模式：右上角浮层，open 控制显隐，onClose 处理关闭
 *
 * 增强：
 *   - 顶部固定显示最新事件（"实时" 区域），让用户一眼就能看到 agent 当前在做什么
 *   - 区域按时间倒序展开，附数量统计
 *   - 支持 "auto-scroll to top"：新事件总是出现在顶部（最新的事件最显眼）
 */
import React, { useEffect, useRef } from 'react';
import { X, Sparkles, Wrench, Eye, ListTodo } from 'lucide-react';
import { useAgentStore, AgentEventLike } from './use-agent-store';
import { PlanList, type PlanStepInfo } from './plan-list';
import './agent.css';

const TOOL_PARAMETER_HELP: Record<string, { label: string; empty: string; params: Record<string, string> }> = {
  parse_user_goal: { label: '解析创作目标', empty: '自动读取你输入的目标，提取题材、时长、风格和交付内容。', params: { user_text: '你对作品的原始描述' } },
  create_plan: { label: '制定执行计划', empty: '根据已确认的目标和素材自动安排执行步骤。', params: { goal: '已经解析的创作目标', available_tools: '允许使用的工具范围' } },
  ask_user: { label: '向你确认信息', empty: '当前没有额外参数；agent 正在等待你的回答。', params: { question: '要向你确认的问题', options: '可选答案（也可以直接输入）' } },
  generate_script: { label: '编写脚本', empty: '使用当前已确认的故事来源生成分场脚本。', params: { long_text: '故事原文或宣传文案', source_kind: '素材类型：小说/短剧或宣传文案' } },
  extract_characters: { label: '整理角色信息', empty: '从当前脚本中整理角色列表，不需要手动填写参数。', params: { script: '要分析的脚本内容' } },
  extract_props: { label: '整理道具信息', empty: '从当前脚本中整理道具列表，不需要手动填写参数。', params: { script: '要分析的脚本内容' } },
  extract_scenes: { label: '整理场景信息', empty: '从当前脚本中整理场景列表，不需要手动填写参数。', params: { script: '要分析的脚本内容' } },
  extract_shots: { label: '整理分镜信息', empty: '从当前脚本中整理镜头列表，不需要手动填写参数。', params: { script: '要分析的脚本内容' } },
  optimize_prompt: { label: '优化生成提示词', empty: '把画面描述转换成适合模型生成的专业提示词。', params: { prompt: '需要优化的画面描述', target: '生成目标：图片或视频', context: '角色、场景和风格等上下文' } },
  generate_character_portrait: { label: '生成角色设计图', empty: '根据角色设定生成角色参考图/三视图。', params: { character: '角色设定', reference_asset_ids: '参考资产', model_id: '使用的图片模型' } },
  generate_prop_image: { label: '生成道具图', empty: '根据道具设定生成可复用的道具参考图。', params: { prop: '道具设定', reference_asset_ids: '参考资产', model_id: '使用的图片模型' } },
  generate_scene_image: { label: '生成场景图', empty: '根据场景设定生成环境参考图。', params: { scene: '场景设定', reference_asset_ids: '参考资产', model_id: '使用的图片模型' } },
  generate_storyboard_image: { label: '生成分镜图', empty: '结合分镜、角色、场景和道具参考生成分镜画面。', params: { shot: '分镜描述', characters: '角色参考', props: '道具参考', scene_asset_id: '场景参考资产' } },
  generate_media_batch: { label: '批量生成媒体资产', empty: '并行生成多个图片或视频资产，单项失败不会阻塞其他任务。', params: { jobs: '待生成的图片/视频任务列表' } },
  generate_video: { label: '生成视频片段', empty: '根据分镜描述和参考图生成视频片段。', params: { shot: '分镜描述', reference_urls: '角色或场景参考图', model_id: '使用的视频模型' } },
  generate_voiceover: { label: '生成配音', empty: '把旁白或台词转换成语音。', params: { text: '需要朗读的文字', voice: '音色选择' } },
  generate_bgm: { label: '生成背景音乐', empty: '根据情绪和时长生成背景音乐。', params: { mood: '音乐情绪', duration_sec: '音乐时长（秒）', style: '音乐风格' } },
  save_asset: { label: '保存资产', empty: '把生成结果保存到当前项目资产库。', params: { asset_kind: '资产类型', name: '资产名称', content: '要保存的内容' } },
  get_artifacts: { label: '查询项目资产', empty: '查询当前项目已经生成或保存的资产。', params: { asset_kind: '要查询的资产类型' } },
};

function summarizeToolValue(value: any): string {
  if (value === null || value === undefined || value === '') return '未提供';
  if (Array.isArray(value)) return value.length ? `已提供 ${value.length} 项` : '空列表';
  if (typeof value === 'object') {
    const name = value.name || value.title || value.id;
    return name ? `已提供「${String(name).slice(0, 50)}」` : '已提供结构化信息';
  }
  const text = String(value);
  return text.length > 100 ? `${text.slice(0, 100)}…` : text;
}

export function formatToolCall(tool: string, params: Record<string, any> = {}): string {
  const help = TOOL_PARAMETER_HELP[tool];
  const label = help?.label || tool.replace(/_/g, ' ');
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return `${label}\n说明：${help?.empty || '正在执行这项操作。'}\n技术名称：${tool}`;
  const lines = entries.map(([key, value]) => `${help?.params[key] || key}：${summarizeToolValue(value)}`);
  return `${label}\n${lines.join('；')}\n技术名称：${tool}`;
}

function fmtPayload(ev: AgentEventLike): string {
  const p = ev.payload || {};
  if (ev.type === 'tool_retrying') return `🔄 重试中 (第 ${p.attempt}/${p.max_retries} 次): ${p.error}`;
  if (ev.type === 'tool_fallback_model') return `↩ 已切换到备选模型: ${p.to_model}`;
  if (ev.type === 'plan_ready') return `已生成计划（${Array.isArray(p.plan) ? p.plan.length : 0} 步）`;
  if (ev.type === 'plan_revised') return `已修订计划`;
  if (ev.type === 'artifact_created') return `✨ 资产已生成: ${p.name || p.kind || p.id}`;
  if (ev.type === 'request_user_input') return `❓ ${p.question || 'agent 想要确认一些信息'}`;
  if (ev.type === 'task_done') return `✅ 任务完成`;
  if (ev.type === 'task_failed') return `❌ 任务失败: ${p.error || '未知错误'}`;
  if (ev.type === 'task_paused') return `⏸ 任务已暂停`;
  if (ev.type === 'task_resumed') return `▶ 任务已恢复`;
  if (ev.type === 'cost_update') return `💰 累计消耗 $${Number(p.cost_usd || 0).toFixed(4)} (${p.tokens || 0} tokens)`;
  if (ev.type === 'goal_parsed') return `🎯 已解析目标: ${(p.plan?.[0]?.title) || '生成计划'}`;
  if (typeof p.message === 'string' && p.message.trim()) return p.message;
  if (typeof p.text === 'string') return p.text;
  // 历史记录可能仍带有旧版的空响应错误；这类情况是内部自动恢复，
  // 不应在用户界面显示为失败。
  if (p.tool === '_llm_call' && typeof p.error === 'string' && /empty response/i.test(p.error)) {
    return '模型暂未返回内容，正在自动重试';
  }
  if (typeof p.tool === 'string') {
    return formatToolCall(p.tool, p.params && typeof p.params === 'object' ? p.params : {});
  }
  // 后端在没有返回详细结果时可能携带 result=null。错误信息必须优先于
  // 空结果展示，否则用户只会看到“null”，无法判断真正的失败原因。
  if (typeof p.error === 'string' && p.error.trim()) return `失败：${p.error}`;
  if (p.result !== undefined) {
    const r = p.result;
    if (r === null) {
      return p.success === false ? '操作失败（未返回详细结果）' : '操作已完成（未返回详细结果）';
    }
    if (r && typeof r === 'object' && 'ok' in r) {
      return r.ok ? 'ok' : `error: ${(r as any).error || 'unknown'}`;
    }
    return JSON.stringify(r).slice(0, 200);
  }
  return JSON.stringify(p).slice(0, 200);
}

function eventBadge(ev: AgentEventLike): { icon: React.ReactNode; label: string } {
  switch (ev.type) {
    case 'thought': return { icon: <Sparkles size={10} />, label: '思考' };
    case 'action': return { icon: <Wrench size={10} />, label: '动作' };
    case 'observation': return { icon: <Eye size={10} />, label: '观察' };
    case 'plan_ready':
    case 'plan_revised':
    case 'goal_parsed':
      return { icon: <ListTodo size={10} />, label: '计划' };
    case 'artifact_created': return { icon: <Sparkles size={10} />, label: '资产' };
    case 'request_user_input': return { icon: <ListTodo size={10} />, label: '提问' };
    case 'task_done': return { icon: <Sparkles size={10} />, label: '完成' };
    case 'task_failed': return { icon: <ListTodo size={10} />, label: '失败' };
    case 'agent_notice': return { icon: <Wrench size={10} />, label: '系统恢复' };
    default: return { icon: <Sparkles size={10} />, label: ev.type };
  }
}

export interface ThoughtStreamProps {
  floating?: boolean;
  open?: boolean;
  onClose?: () => void;
}

const ThoughtStreamBody: React.FC = () => {
  const thoughts = useAgentStore((s) => s.thoughts);
  const actions = useAgentStore((s) => s.actions);
  const observations = useAgentStore((s) => s.observations);
  const status = useAgentStore((s) => s.status);
  const plan = useAgentStore((s) => s.plan);
  const artifacts = useAgentStore((s) => s.artifacts);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);
  const streamingText = useAgentStore((s) => s.streamingText);
  const continueConversation = useAgentStore((s) => s.continueConversation);

  // "重试此步" / "从这步开始" 按钮的回调：发 continueConversation 消息
  // 由后端 runtime 把 user_goal 注入到对话，重新规划 / 重新执行。
  // 注意：后端目前不会"精确重跑"某一步；agent 会基于消息上下文自行决定。
  // 这种语义对用户来说已经够用：把"用户期望"明确告诉 agent。
  const handleRetryStep = async (index: number, step: PlanStepInfo) => {
    const errSuffix = step.errorMessage ? `（上一步错误：${step.errorMessage.slice(0, 120)}）` : '';
    const msg = `请重新执行第 ${index + 1} 步：${step.title}（${step.tool || '该步骤'}）${errSuffix}。请只重做这一步。`;
    try {
      await continueConversation(msg);
    } catch (e) {
      // 错误由 store/SSE 处理；按钮 UI 不变
      console.warn('[plan-list] retry failed:', e);
    }
  };
  const handleResumeFromStep = async (index: number, step: PlanStepInfo) => {
    const msg = `请从第 ${index + 1} 步「${step.title}」（${step.tool || '该步骤'}）开始重新执行该步骤及之后的所有步骤。`;
    try {
      await continueConversation(msg);
    } catch (e) {
      console.warn('[plan-list] resume failed:', e);
    }
  };

  const latestThought = thoughts[thoughts.length - 1];
  const isEmpty = thoughts.length === 0 && actions.length === 0 && observations.length === 0;
  const totalCount = thoughts.length + actions.length + observations.length;

  // 自动滚动到顶部（最新事件在顶部）
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [totalCount]);

  return (
    <div
      ref={bodyRef}
      data-testid="thought-stream"
      className="thought-stream-body"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      {/* 状态指示器 */}
      {status === 'running' && (
        <div data-testid="thought-stream-running" className="thought-stream-status">
          <span className="thought-stream-dot" />
          agent 正在工作…
        </div>
      )}
      {status === 'paused' && (
        <div data-testid="thought-stream-paused" className="thought-stream-status paused">
          <span className="thought-stream-dot" style={{ background: 'var(--muted)', animation: 'none' }} />
          {pendingQuestion ? '等待你的回复' : '已暂停'}
        </div>
      )}
      {status === 'done' && (
        <div data-testid="thought-stream-done" className="thought-stream-status done">
          <span className="thought-stream-dot" style={{ background: 'var(--text)', animation: 'none' }} />
          任务完成 · 共 {totalCount} 个事件
        </div>
      )}
      {status === 'failed' && (
        <div data-testid="thought-stream-failed" className="thought-stream-status failed">
          <span className="thought-stream-dot" style={{ background: 'var(--danger)', animation: 'none' }} />
          任务失败
        </div>
      )}

      {/* 实时事件统计条 */}
      {!isEmpty && (
        <div className="thought-stream-stats">
          <span className="thought-stream-stat-pill">
            <Sparkles size={9} /> 思考 {thoughts.length}
          </span>
          <span className="thought-stream-stat-pill">
            <Wrench size={9} /> 动作 {actions.length}
          </span>
          <span className="thought-stream-stat-pill">
            <Eye size={9} /> 观察 {observations.length}
          </span>
          {plan.length > 0 && (
            <span className="thought-stream-stat-pill">
              <ListTodo size={9} /> 计划 {plan.length}
            </span>
          )}
        </div>
      )}

      {/* 最新 thought 高亮 */}
      {latestThought && (
        <div
          data-testid="thought-stream-latest"
          className="thought-stream-latest"
        >
          <div className="thought-stream-latest-label">💡 最新思考</div>
          <div className="thought-stream-latest-text">{fmtPayload(latestThought)}</div>
        </div>
      )}

      {streamingText && (
        <div data-testid="thought-stream-streaming" className="thought-stream-latest observation">
          <div className="thought-stream-latest-label">文本生成中</div>
          <div className="thought-stream-latest-text">{streamingText}</div>
        </div>
      )}

      {/* 最近动作（最新的 1 个） */}
      {actions.length > 0 && (
        <div className="thought-stream-latest action">
          <div className="thought-stream-latest-label">
            <Wrench size={10} /> 最新动作
          </div>
          <div className="thought-stream-latest-text">
            {fmtPayload(actions[actions.length - 1])}
          </div>
        </div>
      )}

      {/* 最近观察（最新的 1 个） */}
      {observations.length > 0 && (
        <div className="thought-stream-latest observation">
          <div className="thought-stream-latest-label">
            <Eye size={10} /> 最新观察
          </div>
          <div className="thought-stream-latest-text">
            {fmtPayload(observations[observations.length - 1])}
          </div>
        </div>
      )}

      {/* 待用户回复 */}
      {pendingQuestion && (
        <div className="thought-stream-latest pending" data-testid="thought-stream-pending-question">
          <div className="thought-stream-latest-label">❓ agent 提问</div>
          <div className="thought-stream-latest-text">{pendingQuestion.question}</div>
        </div>
      )}

      {/* 计划 — 完整渲染（不截断），每步含状态指示 + 错误摘要 + 重试/从这步开始按钮 */}
      {plan.length > 0 && (
        <div className="thought-stream-section" data-testid="thought-stream-plan-section">
          <div className="thought-stream-section-head">📋 执行计划 ({plan.length})</div>
          <PlanList
            plan={plan}
            actions={actions}
            observations={observations}
            status={status}
            onRetryStep={handleRetryStep}
            onResumeFromStep={handleResumeFromStep}
          />
        </div>
      )}

      {/* 资产 */}
      {Object.keys(artifacts).length > 0 && (
        <div className="thought-stream-section">
          <div className="thought-stream-section-head">🎁 资产 ({Object.values(artifacts).flat().length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.values(artifacts).flat().slice(0, 5).map((a: any, i: number) => (
              <div key={i} className="thought-stream-item">
                {a.name || a.kind || a.id} {a.asset_kind ? `(${a.asset_kind})` : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {isEmpty && (
        <div
          data-testid="thought-stream-empty"
          className="thought-stream-empty"
        >
          等待 agent 开始工作…
        </div>
      )}

      {/* 完整 stream（按时间倒序展开） — 仅在有数据时显示 */}
      {!isEmpty && (
        <details className="thought-stream-details">
          <summary className="thought-stream-details-summary">展开完整记录 ({totalCount})</summary>
          <Section title="思考" testId="thought-stream-thoughts" items={thoughts} />
          <Section title="动作" testId="thought-stream-actions" items={actions} />
          <Section title="观察" testId="thought-stream-observations" items={observations} />
        </details>
      )}
    </div>
  );
};

export const ThoughtStream: React.FC<ThoughtStreamProps> = ({ floating, open, onClose }) => {
  if (floating) {
    if (!open) return null;
    return (
      <div
        data-testid="thought-stream-floating"
        className="thought-stream-floating"
      >
        <div className="thought-stream-head">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            💭 ThoughtStream
          </span>
          <button
            data-testid="thought-stream-floating-close"
            type="button"
            aria-label="close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div className="thought-stream-body-wrap" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <ThoughtStreamBody />
        </div>
      </div>
    );
  }
  return <ThoughtStreamBody />;
};

const Section: React.FC<{
  title: string;
  testId: string;
  items: AgentEventLike[];
}> = ({ title, testId, items }) => {
  if (items.length === 0) {
    return (
      <div data-testid={testId} className="thought-stream-section">
        <div className="thought-stream-section-head">{title} <span style={{ color: 'var(--faint)', textTransform: 'none', fontWeight: 700 }}>(empty)</span></div>
      </div>
    );
  }
  return (
    <div data-testid={testId} className="thought-stream-section">
      <div className="thought-stream-section-head">{title} ({items.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[...items].reverse().map((ev, i) => {
          const b = eventBadge(ev);
          return (
            <div key={i} className="thought-stream-item">
              <span className="thought-stream-item-badge">{b.icon}</span>
              {fmtPayload(ev)}
            </div>
          );
        })}
      </div>
    </div>
  );
};
