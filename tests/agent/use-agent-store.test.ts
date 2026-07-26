/**
 * TDD: useAgentStore (zustand) — 管理 agent 任务状态、事件流、用户交互。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '@/agent/use-agent-store';

describe('useAgentStore', () => {
  beforeEach(() => {
    // 每个测试前 reset
    useAgentStore.getState().reset();
  });

  it('initial state is idle with empty collections', () => {
    const s = useAgentStore.getState();
    expect(s.status).toBe('idle');
    expect(s.taskId).toBeNull();
    expect(s.thoughts).toEqual([]);
    expect(s.actions).toEqual([]);
    expect(s.observations).toEqual([]);
    expect(s.artifacts).toEqual({});
    expect(s.plan).toEqual([]);
    expect(s.pendingQuestion).toBeNull();
    expect(s.error).toBeNull();
  });

  it('setTask seeds taskId and switches to running when status is running', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    const after = useAgentStore.getState();
    expect(after.taskId).toBe('t-1');
    expect(after.status).toBe('running');
  });

  it('setTask resets previous task state (no event leakage when switching tasks)', () => {
    // 模拟先跑 task A：往 store 里塞一些 events
    useAgentStore.getState().setTask('t-A', 'running');
    useAgentStore.getState().applyEvent({ type: 'thought', payload: { text: 'A 的想法' }, timestamp: 1 });
    useAgentStore.getState().applyEvent({ type: 'action', payload: { tool: 'a_tool' }, timestamp: 2 });
    useAgentStore.getState().applyEvent({ type: 'observation', payload: { ok: true }, timestamp: 3 });
    expect(useAgentStore.getState().thoughts).toHaveLength(1);
    expect(useAgentStore.getState().actions).toHaveLength(1);
    expect(useAgentStore.getState().observations).toHaveLength(1);

    // 切到 task B：setTask 应当把 events 全清掉
    useAgentStore.getState().setTask('t-B', 'paused');

    const after = useAgentStore.getState();
    expect(after.taskId).toBe('t-B');
    expect(after.status).toBe('paused');
    expect(after.thoughts).toEqual([]);
    expect(after.actions).toEqual([]);
    expect(after.observations).toEqual([]);
    expect(after.plan).toEqual([]);
    expect(after.artifacts).toEqual({});
  });

  it('hydrate restores plan / artifacts / status / cost from persisted snapshot', () => {
    useAgentStore.getState().setTask('t-1', 'paused');
    useAgentStore.getState().hydrate({
      status: 'done',
      plan: [{ tool: 'a' }, { tool: 'b' }],
      artifacts: { character: [{ id: 'c1', kind: 'image', url: 'http://x' }] },
      total_cost_usd: 0.0123,
      total_tokens: 4567,
    });
    const after = useAgentStore.getState();
    expect(after.status).toBe('done');
    expect(after.plan).toEqual([{ tool: 'a' }, { tool: 'b' }]);
    expect(after.artifacts.character).toHaveLength(1);
    expect(after.totalCostUsd).toBe(0.0123);
    expect(after.totalTokens).toBe(4567);
  });

  it('hydrate restores pendingQuestion when pending_response is an unanswered ask_user payload', () => {
    useAgentStore.getState().setTask('t-2', 'paused');
    useAgentStore.getState().hydrate({
      status: 'paused',
      pending_response: {
        question: '你想要的题材是？',
        options: ['科幻', '悬疑'],
      },
    });
    const after = useAgentStore.getState();
    expect(after.pendingQuestion).not.toBeNull();
    expect(after.pendingQuestion!.question).toBe('你想要的题材是？');
    expect(after.pendingQuestion!.options).toEqual([
      { id: 'option-0', label: '科幻' },
      { id: 'option-1', label: '悬疑' },
    ]);
  });

  it('hydrate ignores pending_response that already has a response (already answered)', () => {
    useAgentStore.getState().setTask('t-3', 'paused');
    useAgentStore.getState().hydrate({
      status: 'paused',
      pending_response: { response: '科幻', approved: true },
    });
    // 已 answered 的 pending_response：旧逻辑期望 null；新行为是给一个
    // 通用"已提交"灰色卡，避免图2"异常刷新后状态丢失"——因为任务实际处于
    // 等待 backend resume 的状态，UI 必须保留可见的灰色卡。
    const after = useAgentStore.getState();
    expect(after.pendingQuestion).not.toBeNull();
    expect(after.pendingQuestion!.question).toContain('已提交');
    expect(after.pendingQuestionAnswered).toBe(true);
  });

  it('hydrate 用 pending_response.question 重建灰色 question 卡（resume 失败回滚场景）', () => {
    // 回归：用户提交回复后 backend resume 失败，回滚到 paused。
    // 旧逻辑：pendingQuestion=null，UI 出现空白卡，pendingQuestionAnswered=false
    // 状态显示异常。
    // 新逻辑：从 pending_response.question 还原灰色 question，并标记 answered。
    useAgentStore.getState().setTask('t-resume-fail', 'paused');
    useAgentStore.getState().hydrate({
      status: 'paused',
      pending_response: {
        response: '角色、道具、场景、分镜',
        question: '你希望我为你生成哪些交付物？',
      },
    });
    const after = useAgentStore.getState();
    expect(after.pendingQuestion).not.toBeNull();
    expect(after.pendingQuestion!.question).toBe('你希望我为你生成哪些交付物？');
    // 关键：标记为已答，UI 显示灰色"已提交"卡
    expect(after.pendingQuestionAnswered).toBe(true);
  });

  it('hydrate 兜底：用 task_profile.user_confirmed_deliverables 重建灰色 question', () => {
    // 后端 user_respond 在更早版本没存 question 字段，
    // task_profile 里有 user_confirmed_deliverables 时可还原。
    useAgentStore.getState().setTask('t-confirmed', 'paused');
    useAgentStore.getState().hydrate({
      status: 'paused',
      pending_response: { response: '角色、道具、场景、分镜', approved: true },
      task_profile: {
        task_type: 'custom',
        input_mode: 'single_asset',
        source_kind: 'topic',
        script_required: false,
        needs_clarification: false,
        deliverables: ['character', 'prop', 'scene', 'storyboard'],
        asset_strategy: 'request or create required assets',
        confidence: 0.85,
        missing_inputs: [],
        rule_pack_id: 'custom.v1',
        user_confirmed_deliverables: ['character', 'prop', 'scene', 'storyboard'],
        user_excluded_deliverables: [],
      },
    });
    const after = useAgentStore.getState();
    expect(after.pendingQuestion).not.toBeNull();
    expect(after.pendingQuestion!.question).toContain('你已确认交付物');
    expect(after.pendingQuestion!.question).toContain('character');
    expect(after.pendingQuestionAnswered).toBe(true);
  });

  it('hydrate 兜底：无 question 缓存 + 无 confirmed 时给通用"已提交"提示', () => {
    // 极端情况：旧数据无 question 缓存、task_profile 也无 user_confirmed 信息。
    // UI 至少要显示一个非空 question 卡，避免空白卡。
    useAgentStore.getState().setTask('t-fallback', 'paused');
    useAgentStore.getState().hydrate({
      status: 'paused',
      pending_response: { response: '一些文字回答' },
    });
    const after = useAgentStore.getState();
    expect(after.pendingQuestion).not.toBeNull();
    expect(after.pendingQuestion!.question).toContain('已提交');
    expect(after.pendingQuestionAnswered).toBe(true);
  });

  it('hydrate 兜底：steps 中最近 ask_user step 的 question 文本被用于恢复', () => {
    // 关键：即使 pending_response.question 缺失、task_profile 也无 confirmed，
    // hydrate 必须能从 steps 历史中提取真实问题文本。
    // 解决了"图1：agent 正在等待你的回复"卡片下方空白的 bug。
    useAgentStore.getState().setTask('t-steps', 'paused');
    useAgentStore.getState().hydrate({
      status: 'paused',
      pending_response: { response: '我的回答' },
      steps: [
        {
          step_number: 1,
          action: { tool: 'parse_user_goal', params: {} },
          observation: { success: true },
          status: 'success',
        },
        {
          step_number: 2,
          action: {
            tool: 'ask_user',
            params: {
              question: '请提供异世界主题的世界观细节（西式奇幻/东方仙侠/赛博魔法等）',
            },
          },
          observation: { user_response: '我的回答' },
          status: 'success',
        },
      ],
    });
    const after = useAgentStore.getState();
    expect(after.pendingQuestion).not.toBeNull();
    expect(after.pendingQuestion!.question).toContain('异世界主题');
    expect(after.pendingQuestionAnswered).toBe(true);
  });

  it('currentActivity 由 action 事件的 tool 字段推导', () => {
    // 关键：用户应该能在不打开 ThoughtStream 的情况下感知 agent 在做什么
    // （如"正在优化提示词"/"正在生成角色图"）。
    useAgentStore.getState().setTask('t-activity', 'running');
    useAgentStore.getState().applyEvent({
      type: 'action',
      payload: { tool: 'optimize_prompt', params: { target: 'image' } },
      timestamp: 1,
    });
    // optimize_prompt 工具动作的 label 暂不区分 video/image，区分在
    // prompt_optimization_started 事件里覆盖。
    expect(useAgentStore.getState().currentActivity).toBe('正在优化提示词…');

    useAgentStore.getState().applyEvent({
      type: 'action',
      payload: { tool: 'generate_character_portrait', params: { character: { name: '林尘' } } },
      timestamp: 2,
    });
    expect(useAgentStore.getState().currentActivity).toBe('正在生成角色图：林尘…');
  });

  it('currentActivity 被 prompt_optimization_started 覆盖（提示词优化期间）', () => {
    // 关键：当 agent 调用 optimize_prompt 工具时，活动指示器必须切换成
    // "正在优化提示词"，让用户知道当前阶段。
    useAgentStore.getState().setTask('t-prompt', 'running');
    useAgentStore.getState().applyEvent({
      type: 'action',
      payload: { tool: 'generate_character_portrait', params: { character: { name: 'A' } } },
      timestamp: 1,
    });
    expect(useAgentStore.getState().currentActivity).toBe('正在生成角色图：A…');
    useAgentStore.getState().applyEvent({
      type: 'prompt_optimization_started',
      payload: { target: 'image' },
      timestamp: 2,
    });
    expect(useAgentStore.getState().currentActivity).toBe('正在优化图像提示词…');
  });

  it('currentActivity 在 task_paused / task_done / task_failed 时清空', () => {
    // 关键：暂停（被问问题）或终态时，活动指示器必须隐藏，避免误导用户。
    useAgentStore.getState().setTask('t-clear', 'running');
    useAgentStore.getState().applyEvent({
      type: 'action',
      payload: { tool: 'generate_video', params: {} },
      timestamp: 1,
    });
    expect(useAgentStore.getState().currentActivity).toBe('正在生成视频…');
    useAgentStore.getState().applyEvent({
      type: 'task_paused',
      payload: {},
      timestamp: 2,
    });
    expect(useAgentStore.getState().currentActivity).toBeNull();

    // task_done 也会清空
    useAgentStore.getState().applyEvent({
      type: 'action',
      payload: { tool: 'generate_script', params: {} },
      timestamp: 3,
    });
    expect(useAgentStore.getState().currentActivity).toBe('正在编写脚本…');
    useAgentStore.getState().applyEvent({
      type: 'task_done',
      payload: {},
      timestamp: 4,
    });
    expect(useAgentStore.getState().currentActivity).toBeNull();
  });

  it('hydrate 不修改 pendingQuestionAnswered when pending_question 已存在', () => {
    // 重开历史 paused 任务，已有 pending_question → 保留 store 中已有的 answered 状态
    useAgentStore.getState().setTask('t-keep', 'paused');
    useAgentStore.getState().applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    useAgentStore.getState().markPendingQuestionAnswered();
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(true);

    useAgentStore.getState().hydrate({
      status: 'paused',
      pending_question: { question: 'q' },
    });
    // 仍为 true，因为 pending_question 存在
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(true);
  });

  it('hydrate clears pendingQuestion when status is not paused (forceReconnect race)', () => {
    // 用户提交回复 → respondAgent+resumeAgent 成功 → forceReconnect 触发 rehydrate。
    // 后端 resume 是异步的，rehydrate 拉到的 snapshot.status 可能是 running。
    // 此时不应恢复 pendingQuestion，否则 UI 再次渲染回复卡让用户卡死。
    useAgentStore.getState().setTask('t-recon', 'paused');
    useAgentStore.getState().applyEvent({
      type: 'request_user_input',
      payload: {
        question: '请确认是否继续',
        options: ['是', '否'],
        selection_mode: 'single',
        context: {},
        step_id: 'confirm',
      },
      timestamp: 1,
    });
    expect(useAgentStore.getState().pendingQuestion).not.toBeNull();

    // 模拟 rehydrate：snapshot.status='running'（后端已 resume）
    useAgentStore.getState().hydrate({
      status: 'running',
      pending_question: {
        question: '请确认是否继续',
        options: ['是', '否'],
      },
    });
    expect(useAgentStore.getState().status).toBe('running');
    expect(useAgentStore.getState().pendingQuestion).toBeNull();
  });

  it('applyEvent adds thought to thoughts list', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'thought', payload: { text: '我先解析用户目标' }, timestamp: 1 });
    expect(useAgentStore.getState().thoughts).toEqual([
      { type: 'thought', payload: { text: '我先解析用户目标' }, timestamp: 1 },
    ]);
  });

  it('ignores empty thought events instead of rendering blank cards', () => {
    const s = useAgentStore.getState();
    s.applyEvent({ type: 'thought', payload: { text: '   ' }, timestamp: 1 });
    expect(useAgentStore.getState().thoughts).toHaveLength(0);
  });

  it('keeps hydrated and replayed state when task_started arrives again', () => {
    const s = useAgentStore.getState();
    s.setTask('t-reconnect', 'running');
    s.applyEvent({ type: 'thought', payload: { text: '已有思考' }, timestamp: 1 });
    s.applyEvent({ type: 'plan_ready', payload: { plan: [{ tool: 'generate_script' }] }, timestamp: 2 });
    s.applyEvent({ type: 'task_started', payload: { llm_mode: 'real' }, timestamp: 3 });
    s.applyEvent({ type: 'thought', payload: { text: '已有思考' }, timestamp: 1 });

    const after = useAgentStore.getState();
    expect(after.thoughts).toHaveLength(1);
    expect(after.plan).toEqual([{ tool: 'generate_script' }]);
  });

  it('applyEvent adds action to actions list', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'action', payload: { tool: 'parse_user_goal', params: {} }, timestamp: 1 });
    expect(useAgentStore.getState().actions).toHaveLength(1);
    expect(useAgentStore.getState().actions[0].payload.tool).toBe('parse_user_goal');
  });

  it('applyEvent adds observation to observations list', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'observation', payload: { result: { ok: true } }, timestamp: 1 });
    expect(useAgentStore.getState().observations).toHaveLength(1);
  });

  it('applyEvent plan_ready sets plan array', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'plan_ready',
      payload: { plan: [{ step: 1, tool: 'generate_script' }] },
      timestamp: 1,
    });
    expect(useAgentStore.getState().plan).toEqual([{ step: 1, tool: 'generate_script' }]);
  });

  it('applyEvent artifact_created merges into artifacts by category', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'artifact_created',
      payload: { kind: 'image', asset_kind: 'character', id: 'a1', name: '林尘' },
      timestamp: 1,
    });
    const arts = useAgentStore.getState().artifacts;
    expect(arts.character).toEqual([
      { kind: 'image', asset_kind: 'character', id: 'a1', name: '林尘' },
    ]);
  });

  it('applyEvent artifact_created replaces a pending media asset with its completed state', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'artifact_created', payload: { kind: 'image', asset_kind: 'character', id: 'a1', generating: true }, timestamp: 1 });
    s.applyEvent({ type: 'artifact_created', payload: { kind: 'image', asset_kind: 'character', id: 'a1', url: 'https://cdn.test/a1.png', generating: false }, timestamp: 2 });

    expect(useAgentStore.getState().artifacts.character).toEqual([
      expect.objectContaining({ id: 'a1', url: 'https://cdn.test/a1.png', generating: false }),
    ]);
  });

  it('applyEvent request_user_input sets pendingQuestion', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({
      type: 'request_user_input',
      payload: { question: '主角是男是女？', options: ['男', '女'] },
      timestamp: 1,
    });
    expect(useAgentStore.getState().pendingQuestion).toMatchObject({
      question: '主角是男是女？',
      options: [{ id: 'option-0', label: '男' }, { id: 'option-1', label: '女' }],
      selection_mode: 'single',
    });
  });

  it('keeps a pending question during replayed thoughts while paused', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({ type: 'request_user_input', payload: { question: '请输入补充说明' }, timestamp: 1 });
    s.applyEvent({ type: 'thought', payload: { text: '历史思考事件' }, timestamp: 2 });
    s.applyEvent({ type: 'action', payload: { tool: 'ask_user' }, timestamp: 3 });

    expect(useAgentStore.getState().pendingQuestion?.question).toBe('请输入补充说明');
  });

  it('normalizes legacy string options as single-select options', () => {
    useAgentStore.getState().applyEvent({
      type: 'request_user_input',
      payload: { question: '选择题材', options: ['古风', '现代'] },
    });

    expect(useAgentStore.getState().pendingQuestion).toMatchObject({
      selection_mode: 'single',
      options: [
        { id: 'option-0', label: '古风' },
        { id: 'option-1', label: '现代' },
      ],
    });
  });

  it('preserves structured multiple-select metadata and response arrays', () => {
    useAgentStore.getState().applyEvent({
      type: 'request_user_input',
      payload: {
        question: '选择标签',
        options: [{ id: 'style', label: '古风' }, { id: 'tone', label: '悬疑' }],
        selection_mode: 'multiple',
        allow_custom: true,
        min_selections: 1,
        max_selections: 2,
      },
    });

    expect(useAgentStore.getState().pendingQuestion).toMatchObject({
      selection_mode: 'multiple',
      allow_custom: true,
      min_selections: 1,
      max_selections: 2,
      options: [
        { id: 'style', label: '古风' },
        { id: 'tone', label: '悬疑' },
      ],
    });

    useAgentStore.getState().applyEvent({
      type: 'user_input_received',
      payload: { response: ['古风', '悬疑'], custom_text: '节奏偏快' },
    });
    expect(useAgentStore.getState().pendingQuestion).not.toBeNull();
  });

  it('keeps pendingQuestion until resumed execution actually starts', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    s.applyEvent({ type: 'user_input_received', payload: { response: 'r', approved: true }, timestamp: 2 });
    expect(useAgentStore.getState().pendingQuestion).not.toBeNull();
    s.applyEvent({ type: 'thought', payload: { text: '继续处理回答' }, timestamp: 3 });
    expect(useAgentStore.getState().pendingQuestion).toBeNull();
  });

  it('shows asset inspection and normalization progress in thoughts', () => {
    useAgentStore.getState().setTask('t-asset', 'running');
    useAgentStore.getState().applyEvent({
      type: 'asset_inspection_started',
      payload: { asset_id: 'a1', text: '正在检查上传资产' },
      timestamp: 1,
    });
    useAgentStore.getState().applyEvent({
      type: 'asset_normalization_started',
      payload: { asset_id: 'a2', source_asset_id: 'a1', text: '正在生成标准角色设计图' },
      timestamp: 2,
    });
    expect(useAgentStore.getState().thoughts).toHaveLength(2);
    expect(useAgentStore.getState().thoughts[1].payload?.text).toContain('标准角色');
  });

  it('applyEvent task_done sets status to done', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'task_done', payload: {}, timestamp: 1 });
    expect(useAgentStore.getState().status).toBe('done');
  });

  it('applyEvent task_done stores assets_summary and missing_deliverables from payload', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'task_done',
      payload: {
        assets_summary: { script: 1, character: 4 },
        missing_deliverables: ['storyboard', 'video'],
        incomplete: true,
        total_assets: 5,
      },
      timestamp: 2,
    });
    const st = useAgentStore.getState();
    expect(st.status).toBe('done');
    expect(st.assetsSummary).toEqual({ script: 1, character: 4 });
    expect(st.missingDeliverables).toEqual(['storyboard', 'video']);
  });

  it('hydrate computes assetsSummary from artifacts when task is done', () => {
    const s = useAgentStore.getState();
    s.reset();
    s.setTask('t-done', 'done');
    s.hydrate({
      status: 'done',
      artifacts: {
        script: [{ id: 's1', failed: false }],
        storyboard: [{ id: 'sb1', failed: false }],
      },
      task_profile: {
        task_type: 'drama_short',
        rule_pack_id: 'drama_short.v1',
        deliverables: ['script', 'storyboard', 'video'],
      },
    });
    const st = useAgentStore.getState();
    expect(st.assetsSummary).toEqual({ script: 1, storyboard: 1 });
    expect(st.missingDeliverables).toEqual(['video']);
  });

  it('applyEvent task_failed sets status to failed and records error', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'task_failed', payload: { error: '出错了' }, timestamp: 1 });
    expect(useAgentStore.getState().status).toBe('failed');
    expect(useAgentStore.getState().error).toBe('出错了');
  });

  it('applyEvent conversation_continued switches status to running and records turn', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'done');
    s.applyEvent({
      type: 'conversation_continued',
      payload: { user_message: '再生成一个反派', turn: 2, compressed: true },
      timestamp: 1,
    });
    const st = useAgentStore.getState();
    expect(st.status).toBe('running');
    expect(st.error).toBeNull();
    expect(st.conversationTurns).toHaveLength(1);
    expect(st.conversationTurns[0].turn).toBe(2);
    expect(st.conversationTurns[0].user_message).toBe('再生成一个反派');
  });

  it('applyEvent memory_compressed sets memoryCompressed flag', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'memory_compressed',
      payload: { turn: 1, compressed_count: 10, summary_length: 500 },
      timestamp: 1,
    });
    expect(useAgentStore.getState().memoryCompressed).toBe(true);
  });

  it('hydrate restores conversationTurns and memoryCompressed from snapshot', () => {
    const s = useAgentStore.getState();
    s.reset();
    s.setTask('t-done', 'done');
    s.hydrate({
      status: 'done',
      conversation_turns: [
        { turn: 1, user_message: '第一轮', agent_summary: '已生成脚本', step_range: [1, 10] },
      ],
      memory_summary: '已生成脚本和 3 个角色',
      artifacts: {},
    });
    const st = useAgentStore.getState();
    expect(st.conversationTurns).toHaveLength(1);
    expect(st.conversationTurns[0].user_message).toBe('第一轮');
    expect(st.memoryCompressed).toBe(true);
  });

  it('applyEvent cost_update accumulates totalCostUsd', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'cost_update', payload: { cost_usd: 0.05 }, timestamp: 1 });
    s.applyEvent({ type: 'cost_update', payload: { cost_usd: 0.10 }, timestamp: 2 });
    expect(useAgentStore.getState().totalCostUsd).toBeCloseTo(0.15);
  });

  it('clearPendingQuestion clears pendingQuestion only', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    s.clearPendingQuestion();
    expect(useAgentStore.getState().pendingQuestion).toBeNull();
    expect(useAgentStore.getState().status).toBe('paused');
  });

  it('markPendingQuestionAnswered flips the answered flag', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(false);
    s.markPendingQuestionAnswered();
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(true);
  });

  it('request_user_input resets pendingQuestionAnswered so a new question unlocks the UI', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q1' }, timestamp: 1 });
    s.markPendingQuestionAnswered();
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(true);
    // 新问题到达：answered 必须清零
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q2' }, timestamp: 2 });
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(false);
  });

  it('user_input_received does not clear pendingQuestion; subsequent thought keeps it visible (greyed) when answered', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    s.markPendingQuestionAnswered();
    s.applyEvent({ type: 'user_input_received', payload: { response: 'r' }, timestamp: 2 });
    // user_input_received 不会清掉 question，UI 仍可见
    expect(useAgentStore.getState().pendingQuestion).not.toBeNull();
    // 收到 thought（agent 已经开始思考）→ 因为已 answered，question 必须保持可见
    s.applyEvent({ type: 'thought', payload: { text: 'hmm' }, timestamp: 3 });
    const after = useAgentStore.getState();
    expect(after.pendingQuestion).not.toBeNull();
    expect(after.pendingQuestionAnswered).toBe(true);
  });

  it('task_done clears the greyed-out question so it does not linger with the continue-conversation input', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    // 模拟"已回答且 agent 在思考"的状态
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    s.markPendingQuestionAnswered();
    s.applyEvent({ type: 'user_input_received', payload: { response: 'r' }, timestamp: 2 });
    s.applyEvent({ type: 'thought', payload: { text: '正在生成' }, timestamp: 3 });
    expect(useAgentStore.getState().pendingQuestion).not.toBeNull();
    // 任务完成 → question + answered 必须清空
    s.applyEvent({ type: 'task_done', payload: {}, timestamp: 4 });
    const after = useAgentStore.getState();
    expect(after.status).toBe('done');
    expect(after.pendingQuestion).toBeNull();
    expect(after.pendingQuestionAnswered).toBe(false);
  });

  it('task_failed clears the greyed-out question so the user can react to the error', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    s.markPendingQuestionAnswered();
    s.applyEvent({ type: 'user_input_received', payload: { response: 'r' }, timestamp: 2 });
    s.applyEvent({ type: 'thought', payload: { text: '处理中' }, timestamp: 3 });
    expect(useAgentStore.getState().pendingQuestion).not.toBeNull();
    s.applyEvent({ type: 'task_failed', payload: { error: '网络错误' }, timestamp: 4 });
    const after = useAgentStore.getState();
    expect(after.status).toBe('failed');
    expect(after.pendingQuestion).toBeNull();
    expect(after.pendingQuestionAnswered).toBe(false);
  });

  it('a new request_user_input replaces the greyed-out question and unlocks the UI', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q1' }, timestamp: 1 });
    s.markPendingQuestionAnswered();
    // 第二个新问题到达 → 旧问题被替换，answered 清零
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q2' }, timestamp: 2 });
    const after = useAgentStore.getState();
    expect(after.pendingQuestion?.question).toBe('q2');
    expect(after.pendingQuestionAnswered).toBe(false);
  });

  it('setConnectionStatus updates the SSE connection banner fields', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.setConnectionStatus('reconnecting', '第 1/8 次重连');
    expect(useAgentStore.getState().connectionStatus).toBe('reconnecting');
    expect(useAgentStore.getState().connectionDetail).toBe('第 1/8 次重连');
    s.setConnectionStatus('disconnected', '已耗尽');
    expect(useAgentStore.getState().connectionStatus).toBe('disconnected');
    s.setConnectionStatus('connected', null);
    expect(useAgentStore.getState().connectionStatus).toBe('connected');
    expect(useAgentStore.getState().connectionDetail).toBeNull();
  });

  it('setReconnectAttempt clamps to non-negative', () => {
    const s = useAgentStore.getState();
    s.setReconnectAttempt(5);
    expect(useAgentStore.getState().reconnectAttempt).toBe(5);
    s.setReconnectAttempt(-1);
    expect(useAgentStore.getState().reconnectAttempt).toBe(0);
  });

  it('hydrate preserves answered when restoring a paused task with pending_question', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    s.markPendingQuestionAnswered();
    // 模拟 forceReconnect 触发的 rehydrate：snapshot 仍然 paused + pending_question
    s.hydrate({
      status: 'paused',
      pending_question: { question: 'q' },
    });
    expect(useAgentStore.getState().pendingQuestion).not.toBeNull();
    // answered 必须保留（避免"刚答完又被解锁"）
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(true);
  });

  it('hydrate clears answered when snapshot has no pending_question (task 已经 running/done)', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    s.markPendingQuestionAnswered();
    s.hydrate({
      status: 'running',
      pending_question: null,
    });
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(false);
  });

  it('reset returns to initial state', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'thought', payload: { text: 'x' }, timestamp: 1 });
    s.reset();
    const after = useAgentStore.getState();
    expect(after.status).toBe('idle');
    expect(after.taskId).toBeNull();
    expect(after.thoughts).toEqual([]);
  });

  it('applyEvent tool_error sets pendingErrorRecovery and status=paused', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '3',
        tool: 'generate_image',
        error: 'network timeout',
        params: { model_id: 'dall-e-3' },
        fallback_model_id: 'dall-e-2',
        available_models: [{ id: 'dall-e-2', label: 'DALL-E 2' }],
      },
      timestamp: 1,
    });
    const after = useAgentStore.getState();
    expect(after.status).toBe('paused');
    expect(after.pendingErrorRecovery).toEqual({
      stepId: '3',
      tool: 'generate_image',
      error: 'network timeout',
      params: { model_id: 'dall-e-3' },
      fallbackModelId: 'dall-e-2',
      availableModels: [{ id: 'dall-e-2', label: 'DALL-E 2' }],
    });
  });

  it('applyEvent tool_resumed clears pendingErrorRecovery and sets status=running', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    // 先触发 tool_error
    s.applyEvent({
      type: 'tool_error',
      payload: { step_id: '1', tool: 'x', error: 'e', params: {}, fallback_model_id: null, available_models: [] },
      timestamp: 1,
    });
    expect(useAgentStore.getState().pendingErrorRecovery).not.toBeNull();
    // 再触发 tool_resumed
    s.applyEvent({ type: 'tool_resumed', payload: { step_id: '1', action: 'retry' }, timestamp: 2 });
    const after = useAgentStore.getState();
    expect(after.pendingErrorRecovery).toBeNull();
    expect(after.status).toBe('running');
  });

  it('applyEvent tool_retrying appends to thoughts', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_retrying',
      payload: { tool: 'generate_image', attempt: 1, max_retries: 2, delay_sec: 1.0, error: 'timeout' },
      timestamp: 1,
    });
    expect(useAgentStore.getState().thoughts).toHaveLength(1);
    expect(useAgentStore.getState().thoughts[0].type).toBe('tool_retrying');
  });

  it('applyEvent tool_fallback_model appends to thoughts', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_fallback_model',
      payload: { tool: 'generate_image', from_model: 'dall-e-3', to_model: 'dall-e-2' },
      timestamp: 1,
    });
    expect(useAgentStore.getState().thoughts).toHaveLength(1);
    expect(useAgentStore.getState().thoughts[0].type).toBe('tool_fallback_model');
  });

  it('clearErrorRecovery clears pendingErrorRecovery', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_error',
      payload: { step_id: '1', tool: 'x', error: 'e', params: {}, fallback_model_id: null, available_models: [] },
      timestamp: 1,
    });
    expect(useAgentStore.getState().pendingErrorRecovery).not.toBeNull();
    useAgentStore.getState().clearErrorRecovery();
    expect(useAgentStore.getState().pendingErrorRecovery).toBeNull();
  });

  it('expand_story action resumes a stale paused pet state and reports story expansion', () => {
    const store = useAgentStore.getState();
    store.setTask('t-expand', 'paused');
    store.applyEvent({
      type: 'request_user_input',
      payload: { question: '请提供故事方向' },
      timestamp: 1,
    });
    store.markPendingQuestionAnswered();

    store.applyEvent({
      type: 'action',
      payload: { tool: 'expand_story', params: { idea_text: '后室' } },
      timestamp: 2,
    });

    const after = useAgentStore.getState();
    expect(after.status).toBe('running');
    expect(after.currentActivity).toBe('正在扩写故事…');
  });

  it('applyEvent agent_notice keeps recovery visible without pausing the agent', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'agent_notice',
      payload: { level: 'warning', message: 'agent 将从最近检查点继续', source: 'auto-recovery' },
      timestamp: 1,
    });
    const after = useAgentStore.getState();
    expect(after.status).toBe('running');
    expect(after.thoughts).toHaveLength(1);
    expect(after.thoughts[0].payload.text).toContain('最近检查点');
  });
});

describe('media_recovery_progress', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('appends a retrying thought with attempt numbers', () => {
    useAgentStore.getState().setTask('t-rec', 'running');
    useAgentStore.getState().applyEvent({
      type: 'media_recovery_progress',
      payload: { tool: 'generate_video', status: 'retrying', attempt: 1, max_attempts: 2, error: 'provider 502' },
      timestamp: 1,
    });
    const s = useAgentStore.getState();
    expect(s.thoughts).toHaveLength(1);
    expect(s.thoughts[0].payload.text).toContain('旁路重试中');
    expect(s.thoughts[0].payload.text).toContain('1/2');
    expect(s.thoughts[0].payload.text).toContain('generate_video');
    expect(s.status).toBe('running');
  });

  it('renders fallback model switch as a thought', () => {
    useAgentStore.getState().setTask('t-rec', 'running');
    useAgentStore.getState().applyEvent({
      type: 'media_recovery_progress',
      payload: { tool: 'generate_video', status: 'fallback_model', from_model: 'm-t2v', to_model: 'm-i2v' },
      timestamp: 1,
    });
    const s = useAgentStore.getState();
    expect(s.thoughts[0].payload.text).toContain('降级模型');
    expect(s.thoughts[0].payload.text).toContain('m-t2v');
    expect(s.thoughts[0].payload.text).toContain('m-i2v');
  });
});
