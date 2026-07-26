import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CanvasAssetPanel } from '../../components/infinite-canvas/CanvasAssetPanel';
import { useCanvasStore } from '../../components/infinite-canvas/use-canvas-store';
import { api } from '../../services/apiClient';

vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../services/apiClient', () => ({
  api: {
    identifyAsset: vi.fn(),
  },
  uploadImageWithPreview: vi.fn(),
}));

describe('CanvasAssetPanel identify (Task 5.2.3/5.2.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCanvasStore.setState({
      taskAssets: [],
      nodes: [],
      connections: [],
      nodeOverrides: {},
      theme: 'light',
    } as any);
  });

  it('shows the identify entry only on pending assets', () => {
    useCanvasStore.setState({
      taskAssets: [
        { id: 'up-1', kind: 'image', name: '未命名图片', url: '/u1.png', inspectionStatus: 'pending' } as any,
        { id: 'ch-1', kind: 'character', name: '林尘', url: '/c1.png', inspectionStatus: 'ready' } as any,
      ],
    } as any);

    render(<CanvasAssetPanel open onClose={() => undefined} />);

    expect(screen.getByTestId('identify-open-up-1')).toBeInTheDocument();
    expect(screen.queryByTestId('identify-open-ch-1')).toBeNull();
  });

  it('submits the correction and persists it into the store', async () => {
    useCanvasStore.setState({
      taskAssets: [
        { id: 'up-1', kind: 'image', name: '未命名图片', url: '/u1.png', inspectionStatus: 'pending' } as any,
      ],
    } as any);
    (api.identifyAsset as any).mockResolvedValue({
      id: 'up-1',
      asset_kind: 'character',
      name: '林尘',
      inspection_status: 'ready',
      story_entity_id: 'entity-1',
    });

    render(<CanvasAssetPanel open onClose={() => undefined} />);

    fireEvent.click(screen.getByTestId('identify-open-up-1'));
    // 未选类型前不能提交
    expect(screen.getByTestId('identify-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('identify-kind-character'));
    fireEvent.change(screen.getByTestId('identify-name-input'), { target: { value: '林尘' } });
    fireEvent.click(screen.getByTestId('identify-submit'));

    await waitFor(() => {
      expect(api.identifyAsset).toHaveBeenCalledWith('up-1', {
        asset_kind: 'character',
        name: '林尘',
        extract_identity: true,
      });
    });
    await waitFor(() => {
      const asset = useCanvasStore.getState().taskAssets.find((a) => a.id === 'up-1') as any;
      expect(asset.kind).toBe('character');
      expect(asset.name).toBe('林尘');
      expect(asset.inspectionStatus).toBe('ready');
    });
    // 更正后不再显示确认入口
    await waitFor(() => {
      expect(screen.queryByTestId('identify-open-up-1')).toBeNull();
    });
  });

  it('offers a voice selector for characters and submits voice_id', async () => {
    useCanvasStore.setState({
      taskAssets: [
        { id: 'up-3', kind: 'image', name: '侧脸照', url: '/u3.png', inspectionStatus: 'pending' } as any,
      ],
    } as any);
    (api.identifyAsset as any).mockResolvedValue({
      id: 'up-3',
      asset_kind: 'character',
      name: '林尘',
      inspection_status: 'ready',
      story_entity_id: 'entity-3',
      voice_id: 'male_calm',
    });

    render(<CanvasAssetPanel open onClose={() => undefined} />);

    fireEvent.click(screen.getByTestId('identify-open-up-3'));
    // 未选角色类型前不出音色选择
    expect(screen.queryByTestId('identify-voice-select')).toBeNull();
    fireEvent.click(screen.getByTestId('identify-kind-character'));
    fireEvent.change(screen.getByTestId('identify-voice-select'), { target: { value: 'male_calm' } });
    fireEvent.click(screen.getByTestId('identify-submit'));

    await waitFor(() => {
      expect(api.identifyAsset).toHaveBeenCalledWith('up-3', {
        asset_kind: 'character',
        name: '侧脸照',
        voice_id: 'male_calm',
        extract_identity: true,
      });
    });
  });

  it('falls back to the current name when the name input is left empty', async () => {    useCanvasStore.setState({
      taskAssets: [
        { id: 'up-2', kind: 'image', name: '青铜剑照片', url: '/u2.png', inspectionStatus: 'pending' } as any,
      ],
    } as any);
    (api.identifyAsset as any).mockResolvedValue({
      id: 'up-2',
      asset_kind: 'prop',
      name: '青铜剑照片',
      inspection_status: 'ready',
      story_entity_id: 'entity-2',
    });

    render(<CanvasAssetPanel open onClose={() => undefined} />);

    fireEvent.click(screen.getByTestId('identify-open-up-2'));
    fireEvent.click(screen.getByTestId('identify-kind-prop'));
    fireEvent.click(screen.getByTestId('identify-submit'));

    await waitFor(() => {
      expect(api.identifyAsset).toHaveBeenCalledWith('up-2', {
        asset_kind: 'prop',
        name: '青铜剑照片',
      });
    });
  });
});
