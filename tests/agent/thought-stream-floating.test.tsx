/**
 * TDD: ThoughtStream 支持 floating 模式（右上角浮层）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThoughtStream } from '@/agent/thought-stream';
import { useAgentStore } from '@/agent/use-agent-store';

describe('<ThoughtStream floating />', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('renders as fixed positioned panel when floating=true', () => {
    render(<ThoughtStream floating open={true} onClose={vi.fn()} />);
    const panel = screen.getByTestId('thought-stream-floating');
    expect(panel).toBeInTheDocument();
    const style = (panel as HTMLElement).style;
    expect(style.position).toBe('fixed');
    expect(style.top).toBeTruthy();
    expect(style.right).toBeTruthy();
  });

  it('hides panel when open=false', () => {
    render(<ThoughtStream floating open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('thought-stream-floating')).toBeNull();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    useAgentStore.getState().setTask('t-1', 'running');
    render(<ThoughtStream floating open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('thought-stream-floating-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('non-floating mode still works as before (default)', () => {
    render(<ThoughtStream />);
    expect(screen.getByTestId('thought-stream')).toBeInTheDocument();
    expect(screen.queryByTestId('thought-stream-floating')).toBeNull();
  });
});
