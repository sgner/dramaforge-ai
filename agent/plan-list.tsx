/**
 * PlanList — 显示完整计划列表（含每步状态：pending / in_progress / completed / failed）。
 *
 * 设计：
 * 1. 不截断：完整渲染所有 plan 步骤（不再是 slice(0, 5) + "还有 N 步"）。
 * 2. 状态推断：根据 actions + observations 推算每一步的运行状态。
 *    工具可能多次调用（如 generate_character_portrait 多个角色），用 step_number 精确匹配。
 * 3. 视觉：每步有圆点状态指示 + 标题 + 工具名 + 错误摘要。
 * 4. 交互：
 *    - failed 步骤 → "重试此步" 按钮（发 continueConversation 消息）
 *    - completed/任意步骤 → "从这步开始" 按钮
 *    - in_progress 步骤 → 实时显示旋转图标
 * 5. 仅在 status === 'paused' | 'failed' | 'done' 时启用按钮（运行中不允许乱点）。
 *
 * 状态推断规则（按 step_number 严格匹配）：
 * - 找到 plan_item.tool 对应的所有 actions（按 step_number 升序）
 * - 取每对 (action, observation) 组合：
 *   - 有 observation.success=true → 计入 completed_count
 *   - 有 observation.success=false → 计入 failed_count
 *   - action 在最后但 observation 还没到 → 视为 in_progress
 * - 综合判定：
 *   - 至少一个 failed 且最近一次是 failed → 'failed'
 *   - 至少一个成功 → 'completed'（即便有 failed，LLM 后续重试成功了）
 *   - 有 in_progress → 'in_progress'
 *   - 否则 → 'pending'
 *
 * 注意：plan 步骤的 `tool` 字段是 LLM 在 create_plan 时指定的；运行时真实调用的
 * 工具可能略有不同（如 batch 工具包多个），但通常 1:1 对应足够。
 */
import React, { useMemo } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  RotateCcw,
  Play,
  ChevronRight,
} from 'lucide-react';
import { useAgentStore, type AgentEventLike } from './use-agent-store';

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface PlanStepInfo {
  index: number;
  title: string;
  tool?: string;
  status: PlanStepStatus;
  errorMessage?: string;
  stepNumber?: number;
}

export interface PlanListProps {
  plan: any[];
  actions: AgentEventLike[];
  observations: AgentEventLike[];
  status: string;
  onRetryStep?: (stepIndex: number, step: PlanStepInfo) => void;
  onResumeFromStep?: (stepIndex: number, step: PlanStepInfo) => void;
}

function planItemTitle(step: any): string {
  return (
    step.title ||
    step.name ||
    step.description ||
    (typeof step === 'string' ? step : JSON.stringify(step).slice(0, 80))
  );
}

function computePlanStatuses(
  plan: any[],
  actions: AgentEventLike[],
  observations: AgentEventLike[],
): PlanStepInfo[] {
  // 建立 step_number -> { action, observation } 索引
  const byStep = new Map<number, { action?: AgentEventLike; observation?: AgentEventLike }>();
  for (const a of actions) {
    const stepNumber = a.payload?.step;
    if (typeof stepNumber === 'number') {
      const entry = byStep.get(stepNumber) || {};
      entry.action = a;
      byStep.set(stepNumber, entry);
    }
  }
  for (const o of observations) {
    const stepNumber = o.payload?.step;
    if (typeof stepNumber === 'number') {
      const entry = byStep.get(stepNumber) || {};
      entry.observation = o;
      byStep.set(stepNumber, entry);
    }
  }

  // 找当前正在执行的动作：最近一个没有 observation 的 action
  const allSteps = Array.from(byStep.values()).sort(
    (a, b) => (a.action?.payload?.step ?? 0) - (b.action?.payload?.step ?? 0),
  );
  let currentStepNumber: number | undefined;
  for (let i = allSteps.length - 1; i >= 0; i--) {
    const entry = allSteps[i];
    if (entry.action && !entry.observation) {
      currentStepNumber = entry.action.payload?.step;
      break;
    }
  }

  return plan.map((step, index) => {
    const stepTool = step?.tool;
    const title = planItemTitle(step);

    if (!stepTool) {
      return { index, title, status: 'pending' as PlanStepStatus };
    }

    // 找所有 step_number 关联的、action.tool 匹配 plan 步骤 tool 的记录
    const matchedEntries = allSteps.filter(
      (entry) => entry.action?.payload?.tool === stepTool,
    );

    if (matchedEntries.length === 0) {
      return { index, title, tool: stepTool, status: 'pending' };
    }

    // 综合判定：取最后一个匹配项作为"最近状态"
    const lastEntry = matchedEntries[matchedEntries.length - 1];
    const lastAction = lastEntry.action;
    const lastObs = lastEntry.observation;
    const lastStepNumber = lastAction?.payload?.step;

    // 当前正在执行（无 observation 且是当前 step）
    if (currentStepNumber === lastStepNumber && lastAction && !lastObs) {
      return {
        index,
        title,
        tool: stepTool,
        status: 'in_progress',
        stepNumber: lastStepNumber,
      };
    }

    if (lastObs) {
      const success = lastObs.payload?.success;
      if (success) {
        return {
          index,
          title,
          tool: stepTool,
          status: 'completed',
          stepNumber: lastStepNumber,
        };
      }
      // 失败：但还要看是否后续有成功（agent 可能自己重试成功了）
      const hasSuccessAfter = matchedEntries.some(
        (entry) =>
          entry.observation &&
          entry.observation.payload?.success === true &&
          (entry.action?.payload?.step ?? 0) > (lastStepNumber ?? 0),
      );
      if (hasSuccessAfter) {
        return {
          index,
          title,
          tool: stepTool,
          status: 'completed',
          stepNumber: lastStepNumber,
        };
      }
      return {
        index,
        title,
        tool: stepTool,
        status: 'failed',
        stepNumber: lastStepNumber,
        errorMessage:
          typeof lastObs.payload?.error === 'string'
            ? lastObs.payload.error
            : undefined,
      };
    }

    // action 在但 observation 没到（且不是 currentStep）
    if (lastAction) {
      return {
        index,
        title,
        tool: stepTool,
        status: 'in_progress',
        stepNumber: lastStepNumber,
      };
    }

    return { index, title, tool: stepTool, status: 'pending' };
  });
}

export const PlanList: React.FC<PlanListProps> = ({
  plan,
  actions,
  observations,
  status,
  onRetryStep,
  onResumeFromStep,
}) => {
  const steps = useMemo(
    () => computePlanStatuses(plan, actions, observations),
    [plan, actions, observations],
  );

  // 仅在任务暂停 / 失败 / 完成时启用交互按钮
  // running 时按钮禁用（避免和正在执行的 agent 抢资源）
  const interactive = status === 'paused' || status === 'failed' || status === 'done';
  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const failedCount = steps.filter((s) => s.status === 'failed').length;
  const inProgressCount = steps.filter((s) => s.status === 'in_progress').length;

  return (
    <div
      data-testid="plan-list"
      className="plan-list"
    >
      {/* 进度统计条 */}
      <div className="plan-list-summary">
        <span className="plan-list-summary-pill completed">
          <CheckCircle2 size={10} /> {completedCount}/{steps.length}
        </span>
        {inProgressCount > 0 && (
          <span className="plan-list-summary-pill in-progress">
            <Loader2 size={10} className="plan-list-spin" /> {inProgressCount}
          </span>
        )}
        {failedCount > 0 && (
          <span className="plan-list-summary-pill failed">
            <XCircle size={10} /> {failedCount}
          </span>
        )}
      </div>

      {/* 完整步骤列表（不截断） */}
      <div className="plan-list-items">
        {steps.map((step) => {
          const isFailed = step.status === 'failed';
          const isCompleted = step.status === 'completed';
          const isInProgress = step.status === 'in_progress';

          return (
            <div
              key={step.index}
              data-testid={`plan-list-item-${step.index}`}
              data-status={step.status}
              className={`plan-list-item plan-list-item-${step.status}`}
            >
              <div className="plan-list-item-icon">
                {isCompleted && <CheckCircle2 size={16} className="plan-list-icon-completed" />}
                {isFailed && <XCircle size={16} className="plan-list-icon-failed" />}
                {isInProgress && (
                  <Loader2 size={16} className="plan-list-icon-running plan-list-spin" />
                )}
                {step.status === 'pending' && (
                  <Circle size={16} className="plan-list-icon-pending" />
                )}
              </div>
              <div className="plan-list-item-body">
                <div className="plan-list-item-title">
                  <span className="plan-list-item-num">{step.index + 1}</span>
                  <span className="plan-list-item-text">{step.title}</span>
                  {step.tool && (
                    <span className="plan-list-item-tool">
                      <ChevronRight size={9} />
                      {step.tool}
                    </span>
                  )}
                </div>
                {isFailed && step.errorMessage && (
                  <div className="plan-list-item-error">{step.errorMessage}</div>
                )}
                {interactive && (isFailed || isCompleted) && (
                  <div className="plan-list-item-actions">
                    {isFailed && onRetryStep && (
                      <button
                        type="button"
                        data-testid={`plan-list-retry-${step.index}`}
                        className="plan-list-action-btn plan-list-action-retry"
                        onClick={() => onRetryStep(step.index, step)}
                        title="重试此步（继续对话时告诉 agent 重新执行这一步）"
                      >
                        <RotateCcw size={11} /> 重试此步
                      </button>
                    )}
                    {isCompleted && onResumeFromStep && (
                      <button
                        type="button"
                        data-testid={`plan-list-resume-${step.index}`}
                        className="plan-list-action-btn plan-list-action-resume"
                        onClick={() => onResumeFromStep(step.index, step)}
                        title="从这一步开始重新执行"
                      >
                        <Play size={11} /> 从这步开始
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
