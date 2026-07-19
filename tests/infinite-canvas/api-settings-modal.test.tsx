import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiSettingsModal } from '@/components/infinite-canvas/ApiSettingsModal';
import { createDefaultApiConfig } from '@/types';
import { normalizeModelBindings } from '@/types';

vi.mock('@/services/apiClient', () => ({
  api: {
    setUserPreference: vi.fn().mockResolvedValue({}),
    upsertProvider: vi.fn().mockResolvedValue({}),
    deleteProvider: vi.fn().mockResolvedValue({}),
  },
}));

describe('<ApiSettingsModal /> capability bindings', () => {
  it('renders only LLM, image, and video capability bindings', () => {
    render(<ApiSettingsModal open config={createDefaultApiConfig()} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    expect(screen.getByTestId('api-capability-binding-llm')).toBeInTheDocument();
    expect(screen.getByTestId('api-capability-binding-image')).toBeInTheDocument();
    expect(screen.getByTestId('api-capability-binding-video')).toBeInTheDocument();
    expect(screen.queryByText('剧本生成')).not.toBeInTheDocument();
    expect(screen.queryByText('角色设计')).not.toBeInTheDocument();
  });

  it('waits for async persistence before showing the saved state', async () => {
    let resolveSave!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    render(<ApiSettingsModal open config={createDefaultApiConfig()} onClose={vi.fn()} onSave={onSave} />);

    const saveButton = document.querySelector('.api-settings-footer .api-save-btn') as HTMLButtonElement;
    fireEvent.click(saveButton);
    await act(async () => { await Promise.resolve(); });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(saveButton.textContent).not.toContain('已保存');

    await act(async () => { resolveSave(); });
    expect(saveButton.textContent).toContain('已保存');
  });

  it('keeps capability binding provider ids aligned with normalized provider ids', async () => {
    const config = {
      providers: [{
        id: 'ZZ', name: 'ZZ', baseUrl: '', protocol: 'openai' as const,
        enabled: true, apiKey: 'key', imageModels: [], chatModels: ['chat-1'], videoModels: [],
      }],
      modelBindings: [
        { kind: 'llm' as const, providerId: 'ZZ', modelId: 'chat-1' },
        { kind: 'image' as const, providerId: '', modelId: '' },
        { kind: 'video' as const, providerId: '', modelId: '' },
      ],
    };
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ApiSettingsModal open config={config} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.click(document.querySelector('.api-settings-footer .api-save-btn') as HTMLButtonElement);
    await act(async () => { await Promise.resolve(); });

    const saved = onSave.mock.calls[0][0];
    expect(saved.providers[0].id).toBe(saved.modelBindings[0].providerId);
  });

  it('matches legacy binding ids to provider ids when casing or punctuation differs', () => {
    const loaded = normalizeModelBindings({
      providers: [{
        id: 'zz', name: 'ZZ', baseUrl: '', protocol: 'openai', enabled: true,
        apiKey: '', imageModels: [], chatModels: ['chat-1'], videoModels: [],
      }],
      modelBindings: [{ kind: 'llm', providerId: 'ZZ', modelId: 'chat-1' }],
    });

    expect(loaded.modelBindings[0].providerId).toBe('zz');
  });

  // 回归测试：bug "首次进入首页点击设置按钮配置窗口没有出现"
  // 根因 — lazy chunk 加载完挂载 modal 时，触发打开按钮的 click 事件
  // 仍在事件循环里，modal 背景的 onClick（点击背景关闭）会立即消费它，
  // 导致 modal 刚挂载就被关掉。
  // 修复：modal 用 mountedAtRef 记录挂载时间，挂载后 150ms 内的背景点击被忽略。
  it('ignores background clicks within 150ms of mount to avoid the open-then-close race', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ApiSettingsModal open config={createDefaultApiConfig()} onClose={onClose} onSave={vi.fn()} />,
    );

    const modalDiv = container.querySelector('.api-settings-modal') as HTMLElement;
    expect(modalDiv).toBeInTheDocument();

    // 模拟"刚挂载时，触发打开的 click 事件尾段落到 modal 背景上" — 应被忽略
    fireEvent.click(modalDiv);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes when the user clicks the background after the grace period', async () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      const { container } = render(
        <ApiSettingsModal open config={createDefaultApiConfig()} onClose={onClose} onSave={vi.fn()} />,
      );

      const modalDiv = container.querySelector('.api-settings-modal') as HTMLElement;
      expect(modalDiv).toBeInTheDocument();

      // 推进 400ms（超过 300ms 保护窗口；之前是 150ms，code 在修复 mount race 时
      // 把 grace period 提到 300ms 以适应更慢的 chunk 加载场景，测试要跟进）。
      await act(async () => {
        vi.advanceTimersByTime(400);
      });

      fireEvent.click(modalDiv);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
