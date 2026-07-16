/**
 * useAgentTools — 拉取 /api/agent/tools 远端元数据。
 *
 * 用法：
 *   const { tools, isLoading, error } = useAgentTools();
 *
 * 行为：
 * - 组件挂载时立即发起 GET /api/agent/tools
 * - 成功：把远端 tool 列表（snake_case → camelCase）写入 state
 * - 失败（网络异常/非 2xx/空数组）：返回空工具列表，error 字段记录真实原因
 * - isLoading 从 true 转为 false
 * - 组件 unmount 时取消未完成的 setState
 */
import { useEffect, useState } from 'react';
import type { PaletteTool } from './tool-palette';

export interface UseAgentToolsResult {
  tools: PaletteTool[];
  isLoading: boolean;
  error: Error | null;
}

interface RemoteTool {
  name: string;
  description?: string;
  category: PaletteTool['category'];
  requires_approval?: boolean;
}

function toPaletteTool(d: RemoteTool): PaletteTool {
  return {
    name: d.name,
    description: d.description ?? '',
    category: d.category,
    requiresApproval: !!d.requires_approval,
  };
}

export function useAgentTools(): UseAgentToolsResult {
  const [tools, setTools] = useState<PaletteTool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent/tools');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RemoteTool[];
        if (cancelled) return;
        if (!Array.isArray(data) || data.length === 0) throw new Error('Agent tool registry returned no tools');
        setTools(data.map(toPaletteTool));
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setTools([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { tools, isLoading, error };
}
