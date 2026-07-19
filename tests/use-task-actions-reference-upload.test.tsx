/**
 * Bug 1 回归测试：角色参考图必须先走 api.uploadImage 拿后端真实 URL（/files/xxx），
 * 不能用 URL.createObjectURL 生成的浏览器本地 blob: URL ——
 * 后端无法下载 blob URL（参考图静默失效），且刷新页面后 blob 死链。
 *
 * 覆盖：
 *  - 成功：character.referenceImage 存的是 /files/ 后端 URL 而非 blob:
 *  - 失败：不写入死链（updateTask 不携带 referenceImage），loading 态被清理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useTaskActions } from '@/hooks/useTaskActions';
import { api } from '@/services/apiClient';
import { subscribeToast } from '@/utils/toast';
import { DramaTask, TaskStatus, ArtStyle, Character } from '@/types';

const mockUploadImage = vi.fn();

vi.mock('@/services/apiClient', () => ({
  api: {
    uploadImage: (...args: any[]) => mockUploadImage(...args),
  },
}));

const makeChar = (name: string): Character => ({
  name,
  visualFeatures: 'features',
  clothing: 'clothing',
  voice: 'voice',
});

const makeTask = (): DramaTask => ({
  id: 'task-1',
  name: 'Test Project',
  style: ArtStyle.REALISTIC,
  language: 'zh',
  mode: 'manual',
  sourceType: 'novel',
  createdAt: Date.now(),
  status: TaskStatus.IDLE,
  stepStatus: 'idle',
  progress: 0,
  rawNovelText: 'some text',
  characters: [makeChar('Alice')],
  bigShots: [],
} as DramaTask);

const makeFileEvent = (file: File) =>
  ({ target: { files: [file], value: 'fake' } }) as unknown as React.ChangeEvent<HTMLInputElement>;

const setupHook = (task: DramaTask) => {
  const updateTask = vi.fn();
  const setUploadingCharName = vi.fn();
  const { result } = renderHook(() =>
    useTaskActions(
      [task],
      vi.fn(),               // setTasks
      task.id,               // activeTaskId
      vi.fn(),               // setActiveTaskId
      {} as any,             // apiConfig
      updateTask,
      vi.fn(),               // executeTaskStep
      vi.fn(),               // setConfirmModal
      vi.fn(),               // setIsNewTaskModalOpen
      'zh',                  // lang
      (key: string) => key,  // t
      vi.fn(),               // setIsExpandingStory
      vi.fn(),               // setIsEditingSourceText
      '',                    // tempSourceText
      'Alice',               // uploadingCharName
      setUploadingCharName,
      vi.fn()                // updateBigShotStatus
    )
  );
  return { result, updateTask, setUploadingCharName };
};

describe('useTaskActions.handleRefFileChange — 参考图先上传后端再存 URL', () => {
  beforeEach(() => {
    mockUploadImage.mockReset();
  });

  it('上传成功：referenceImage 存后端 /files/ URL，而不是 blob: URL', async () => {
    mockUploadImage.mockResolvedValue({ url: '/files/ref_alice.png', filename: 'ref_alice.png', size: 1024 });

    const task = makeTask();
    const { result, updateTask, setUploadingCharName } = setupHook(task);
    const file = new File(['png-bytes'], 'alice.png', { type: 'image/png' });

    await act(async () => {
      await result.current.handleRefFileChange(makeFileEvent(file));
    });

    // 走了后端上传，而不是 URL.createObjectURL
    expect(mockUploadImage).toHaveBeenCalledTimes(1);
    expect(mockUploadImage).toHaveBeenCalledWith(file);

    expect(updateTask).toHaveBeenCalledTimes(1);
    const [taskId, updates] = updateTask.mock.calls[0];
    expect(taskId).toBe('task-1');
    const alice = (updates as Partial<DramaTask>).characters!.find((c) => c.name === 'Alice')!;
    expect(alice.referenceImage).toBe('/files/ref_alice.png');
    expect(alice.referenceImage).not.toMatch(/^blob:/);

    // loading 态与 input 被清理
    expect(setUploadingCharName).toHaveBeenCalledWith(null);
  });

  it('上传失败：不写入死链（不更新 referenceImage），仍清理 loading 态', async () => {
    mockUploadImage.mockRejectedValue(new Error('Upload failed: 500'));
    // alert() 已统一为全局 toast 事件总线，订阅后断言 error 级别提示
    const toastSpy = vi.fn();
    const unsubscribe = subscribeToast(toastSpy);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const task = makeTask();
    const { result, updateTask, setUploadingCharName } = setupHook(task);
    const file = new File(['png-bytes'], 'alice.png', { type: 'image/png' });

    await act(async () => {
      await result.current.handleRefFileChange(makeFileEvent(file));
    });

    expect(mockUploadImage).toHaveBeenCalledTimes(1);
    // 失败路径不得把任何 URL（尤其是 blob: 死链）写进 character.referenceImage
    expect(updateTask).not.toHaveBeenCalled();
    expect(setUploadingCharName).toHaveBeenCalledWith(null);
    expect(toastSpy).toHaveBeenCalled();
    expect(toastSpy.mock.calls[0][0]).toBe('error');

    unsubscribe();
    consoleSpy.mockRestore();
  });
});
