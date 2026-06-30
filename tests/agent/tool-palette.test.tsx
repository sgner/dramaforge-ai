/**
 * TDD: ToolPalette — 展示 agent 可用的 18 个工具（按 6 类分组）。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ToolPalette, PALETTE_TOOLS } from '@/agent/tool-palette';

describe('<ToolPalette />', () => {
  it('renders 6 category sections', () => {
    render(<ToolPalette tools={PALETTE_TOOLS} />);
    const cats = ['planning', 'llm', 'image', 'video', 'audio', 'asset'];
    for (const c of cats) {
      expect(screen.getByTestId(`tool-palette-category-${c}`)).toBeInTheDocument();
    }
  });

  it('renders all 18 tool entries', () => {
    render(<ToolPalette tools={PALETTE_TOOLS} />);
    const items = screen.getAllByTestId('tool-palette-item');
    expect(items).toHaveLength(18);
  });

  it('shows tool name and description for each entry', () => {
    render(<ToolPalette tools={PALETTE_TOOLS} />);
    const items = screen.getAllByTestId('tool-palette-item');
    for (const it of items) {
      // 每个 item 至少包含 tool 名（来自 query）
      expect(it.textContent).toBeTruthy();
    }
  });

  it('planning category has 3 tools', () => {
    render(<ToolPalette tools={PALETTE_TOOLS} />);
    const cat = screen.getByTestId('tool-palette-category-planning');
    const items = within(cat).getAllByTestId('tool-palette-item');
    expect(items).toHaveLength(3);
  });

  it('llm category has 6 tools', () => {
    render(<ToolPalette tools={PALETTE_TOOLS} />);
    const cat = screen.getByTestId('tool-palette-category-llm');
    const items = within(cat).getAllByTestId('tool-palette-item');
    expect(items).toHaveLength(6);
  });

  it('image category has 4 tools', () => {
    render(<ToolPalette tools={PALETTE_TOOLS} />);
    const cat = screen.getByTestId('tool-palette-category-image');
    const items = within(cat).getAllByTestId('tool-palette-item');
    expect(items).toHaveLength(4);
  });

  it('video category has 1 tool', () => {
    render(<ToolPalette tools={PALETTE_TOOLS} />);
    const cat = screen.getByTestId('tool-palette-category-video');
    const items = within(cat).getAllByTestId('tool-palette-item');
    expect(items).toHaveLength(1);
  });

  it('audio category has 2 tools', () => {
    render(<ToolPalette tools={PALETTE_TOOLS} />);
    const cat = screen.getByTestId('tool-palette-category-audio');
    const items = within(cat).getAllByTestId('tool-palette-item');
    expect(items).toHaveLength(2);
  });

  it('asset category has 2 tools', () => {
    render(<ToolPalette tools={PALETTE_TOOLS} />);
    const cat = screen.getByTestId('tool-palette-category-asset');
    const items = within(cat).getAllByTestId('tool-palette-item');
    expect(items).toHaveLength(2);
  });

  it('marks tools that require approval with a badge', () => {
    render(<ToolPalette tools={PALETTE_TOOLS} />);
    // generate_video requires approval (已知)
    const videoCat = screen.getByTestId('tool-palette-category-video');
    const item = within(videoCat).getByTestId('tool-palette-item');
    expect(within(item).getByTestId('tool-palette-requires-approval')).toBeInTheDocument();
  });
});
