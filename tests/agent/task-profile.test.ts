import { beforeEach, describe, expect, it } from 'vitest';
import { useAgentStore } from '@/agent/use-agent-store';
import type { AgentTaskOut } from '@/services/apiClient';

describe('task profile hydration', () => {
  beforeEach(() => useAgentStore.getState().reset());

  it('hydrates task_profile while preserving a durable pending question on replay', () => {
    useAgentStore.getState().setTask('profile-task', 'paused');
    useAgentStore.getState().hydrate({
      task_profile: {
        task_type: 'drama_short',
        rule_pack_id: 'drama_short.v1',
        missing_inputs: ['script'],
      },
      pending_question: {
        step_id: 'clarify_source',
        question: '需要脚本来源',
        missing_inputs: ['script'],
        selection_mode: 'text',
        allow_custom: true,
      },
    });

    expect(useAgentStore.getState().taskProfile).toMatchObject({
      task_type: 'drama_short',
      rule_pack_id: 'drama_short.v1',
    });
    expect(useAgentStore.getState().pendingQuestion).toMatchObject({
      step_id: 'clarify_source',
      selection_mode: 'text',
      allow_custom: true,
    });

    useAgentStore.getState().applyEvent({
      type: 'task_started',
      payload: { llm_mode: 'real' },
      timestamp: 1,
    });
    expect(useAgentStore.getState().pendingQuestion).not.toBeNull();
  });

  it('accepts the API task shape with pending_question and hydrates it after refresh', () => {
    const snapshot: AgentTaskOut = {
      id: 'api-profile-task',
      user_goal: 'promotion',
      status: 'paused',
      plan: [],
      artifacts: {},
      pending_question: {
        step_id: 'clarify_source',
        question: 'Provide the promotion brief',
        missing_inputs: ['promotion_brief'],
        selection_mode: 'text',
        allow_custom: true,
      },
      task_profile: { task_type: 'promotion', rule_pack_id: 'promotion.v1' },
      total_cost_usd: 0,
      total_tokens: 0,
      max_steps: 30,
      skip_confirm: false,
      created_at: '',
      updated_at: '',
    };

    useAgentStore.getState().hydrate(snapshot);

    expect(useAgentStore.getState().pendingQuestion).toMatchObject({
      step_id: 'clarify_source',
      missing_inputs: ['promotion_brief'],
    });
  });
});
