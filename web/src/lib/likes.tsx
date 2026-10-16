import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * 访客本地的「点亮」状态。
 *
 * 重要：这不是全网共享的点赞数。
 *   - 显示出来的数字 = 仓库 JSON 里的 likes（站长维护） + 本机是否点亮（0 或 1）
 *   - 本机点亮记录存在 localStorage，刷新不丢，换设备/换人不会同步
 * 想变成真实共享计数，需要换掉这一层（后端 KV 或 GitHub reactions），
 * 组件那边不用改。
 */
const STORAGE_KEY = 'cursememe:liked';

function readLiked(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeLiked(next: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* 隐私模式下 localStorage 可能不可写，忽略即可 */
  }
}

interface LikeState {
  liked: Set<string>;
  isLiked: (id: string) => boolean;
  toggle: (id: string) => void;
  /** 显示用计数：站长维护值 + 本机点亮增量 */
  displayCount: (entry: { id: string; likes: number }) => number;
}

const LikeContext = createContext<LikeState | null>(null);

export function LikeProvider({ children }: { children: ReactNode }) {
  const [liked, setLiked] = useState<Set<string>>(() => readLiked());

  const toggle = useCallback((id: string) => {
    setLiked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeLiked(next);
      return next;
    });
  }, []);

  const value = useMemo<LikeState>(
    () => ({
      liked,
      isLiked: (id) => liked.has(id),
      toggle,
      displayCount: (entry) => entry.likes + (liked.has(entry.id) ? 1 : 0),
    }),
    [liked, toggle],
  );

  return <LikeContext.Provider value={value}>{children}</LikeContext.Provider>;
}

export function useLikes(): LikeState {
  const context = useContext(LikeContext);
  if (!context) throw new Error('useLikes 必须在 LikeProvider 内使用');
  return context;
}
