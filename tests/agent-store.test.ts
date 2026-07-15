import { describe, expect, it } from 'vitest';
import { useAgentStore } from '../agent/use-agent-store';

describe('agent event projection', () => {
  it('does not duplicate replayed actions and resets a retry attempt', () => {
    const store = useAgentStore.getState();
    store.reset();
    store.applyEvent({ type: 'action', payload: { step: 1, tool: 'parse_user_goal' } });
    store.applyEvent({ type: 'action', payload: { step: 1, tool: 'parse_user_goal' } });
    expect(useAgentStore.getState().actions).toHaveLength(1);

    store.applyEvent({ type: 'task_started', payload: { llm_mode: 'real' } });
    expect(useAgentStore.getState().actions).toHaveLength(0);
  });
});
