/**
 * TDD: Task 5.3 — 项目隔离。
 *
 * 项目 A 正在运行（ThoughtStream 有恢复事件、pendingQuestion 待答、
 * 桌宠 currentActivity 非空）→ 切到项目 B → B 的 Agent 状态必须干净。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { AgentMode } from '@/agent/agent-mode';
import { api } from '@/services/apiClient';
import { useAgentStore } from '@/agent/use-agent-store';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

vi.mock('@/components/infinite-canvas/InfiniteCanvas', () => ({
  InfiniteCanvas: (props: any) => <div data-testid="infinite-canvas-stub" data-project-id={props.projectId} />,
}));

describe('project isolation (Task 5.3)', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    useCanvasStore.setState({ nodes: [], connections: [], nodeOverrides: {}, theme: 'light' });
    vi.restoreAllMocks();
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
    vi.spyOn(api, 'listAgentSteps').mockResolvedValue([]);
    vi.spyOn(api, 'getSnapshot').mockResolvedValue({ nodes: [], connections: [], assets: [] } as any);
  });

  it('switching projects clears task event projections, pending question, and pet state', async () => {
    // 项目 A：正在运行，ThoughtStream 有恢复事件，存在待答问题，桌宠在活动
    const { rerender } = render(<AgentMode projectId="project-A" />);
    useAgentStore.getState().setTask('task-A', 'running', 'project-A');
    useAgentStore.getState().applyEvent({
      type: 'media_recovery_progress',
      payload: { tool: 'generate_video', status: 'retrying', attempt: 1, max_attempts: 2 },
      timestamp: 1,
    });
    useAgentStore.getState().applyEvent({
      type: 'request_user_input',
      payload: { question: '确认角色设定？', options: ['确认'], step_id: 'q1' },
      timestamp: 2,
    });
    useAgentStore.setState({
      currentActivity: '旁路重试中…',
      artifacts: { character: [{ id: 'char-A', name: '林尘', url: 'u' }] } as any,
    });

    const dirty = useAgentStore.getState();
    expect(dirty.thoughts.length).toBeGreaterThan(0);
    expect(dirty.pendingQuestion).not.toBeNull();
    expect(dirty.currentActivity).not.toBeNull();
    expect(Object.keys(dirty.artifacts)).toContain('character');

    // 切到项目 B
    rerender(<AgentMode projectId="project-B" />);

    await waitFor(() => {
      const clean = useAgentStore.getState();
      expect(clean.projectId).not.toBe('project-A');
      expect(clean.thoughts).toEqual([]);
      expect(clean.actions).toEqual([]);
      expect(clean.observations).toEqual([]);
      expect(clean.pendingQuestion).toBeNull();
      expect(clean.currentActivity).toBeNull();
      expect(clean.artifacts).toEqual({});
    });
  });

  it('loadProject clears nodes and taskAssets of the previous project', async () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'img-A', type: 'image', x: 0, y: 0, w: 100, h: 100, url: 'a.png' } as any,
      ],
      taskAssets: [{ id: 'ta-A', kind: 'image', name: 'A资产', url: 'a.png' } as any],
    });

    await useCanvasStore.getState().loadProject('project-B');

    const store = useCanvasStore.getState();
    expect(store.nodes.some((n: any) => n.id === 'img-A')).toBe(false);
    expect(store.taskAssets.some((a: any) => a.id === 'ta-A')).toBe(false);
  });
});
