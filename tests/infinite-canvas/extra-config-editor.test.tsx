/**
 * ExtraConfigEditor（provider 自定义配置模板编辑器）测试。
 *
 * 模板化表单替代手写 JSON：
 * - default：OpenAI 兼容（无自定义配置）
 * - task_api：任务式生成 API（seedance 等），表单字段 → 结构化 extra_config
 * - custom：自定义 JSON 逃生舱
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExtraConfigEditor } from '@/components/infinite-canvas/ApiSettingsModal';

describe('<ExtraConfigEditor />', () => {
  it('空配置 → 默认模板（OpenAI 兼容）', () => {
    render(<ExtraConfigEditor value={undefined} onChange={vi.fn()} />);
    expect(screen.getByTestId('extra-config-template')).toHaveValue('default');
  });

  it('切到任务式模板 → 生成 seedance 形态的结构化配置', () => {
    const onChange = vi.fn();
    render(<ExtraConfigEditor value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('extra-config-template'), { target: { value: 'task_api' } });
    expect(onChange).toHaveBeenCalled();
    const cfg = onChange.mock.calls.at(-1)![0];
    expect(cfg.image.endpoint).toBe('/v1/image/generations');
    expect(cfg.image.async_task).toBe(true);
    expect(cfg.image.payload_extra.metadata).toEqual({ resolution: '2k', output_format: 'jpeg' });
    expect(cfg.image.poll_interval_sec).toBe(3);
    expect(cfg.image.timeout_sec).toBe(300);
    expect(cfg.video).toBeUndefined();
  });

  it('已有任务式配置 → 自动识别模板并回填表单', () => {
    const value = {
      image: {
        endpoint: '/v1/image/generations',
        async_task: true,
        poll_interval_sec: 5,
        timeout_sec: 120,
        payload_extra: { metadata: { resolution: '4k', output_format: 'png' } },
      },
    };
    render(<ExtraConfigEditor value={value} onChange={vi.fn()} />);
    expect(screen.getByTestId('extra-config-template')).toHaveValue('task_api');
    expect(screen.getByTestId('extra-config-apply-image')).toBeChecked();
    expect(screen.getByTestId('extra-config-apply-video')).not.toBeChecked();
    expect(screen.getByTestId('extra-config-resolution')).toHaveValue('4k');
    expect(screen.getByTestId('extra-config-output-format')).toHaveValue('png');
    expect(screen.getByTestId('extra-config-poll-interval')).toHaveValue(5);
    expect(screen.getByTestId('extra-config-timeout')).toHaveValue(120);
  });

  it('勾选视频 → image/video 两段都生成；改端点实时生效', () => {
    const onChange = vi.fn();
    const value = { image: { endpoint: '/v1/image/generations', async_task: true } };
    render(<ExtraConfigEditor value={value} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('extra-config-apply-video'));
    let cfg = onChange.mock.calls.at(-1)![0];
    expect(cfg.video.endpoint).toBe('/v1/videos/generations');
    expect(cfg.video.async_task).toBe(true);

    fireEvent.change(screen.getByTestId('extra-config-video-endpoint'), { target: { value: '/v1/video/generations' } });
    cfg = onChange.mock.calls.at(-1)![0];
    expect(cfg.video.endpoint).toBe('/v1/video/generations');
  });

  it('切回默认模板 → 配置清空', () => {
    const onChange = vi.fn();
    const value = { image: { endpoint: '/v1/image/generations', async_task: true } };
    render(<ExtraConfigEditor value={value} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('extra-config-template'), { target: { value: 'default' } });
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('自定义 JSON 模式：非法 JSON 不生效，合法 JSON 生效', () => {
    const onChange = vi.fn();
    render(<ExtraConfigEditor value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('extra-config-template'), { target: { value: 'custom' } });
    const textarea = screen.getByTestId('extra-config-editor');

    fireEvent.change(textarea, { target: { value: '{bad json' } });
    fireEvent.blur(textarea);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: '{"image":{"endpoint":"/x"}}' } });
    fireEvent.blur(textarea);
    expect(onChange).toHaveBeenCalledWith({ image: { endpoint: '/x' } });
  });
});
