import { useCallback, useState } from 'react';
import type { Entry } from '../types';

/**
 * 预览弹窗的选中项 + 它在当前列表里的位置。
 *
 * 用 id 而不是对象来记选中项，是为了让「上一条 / 下一条」在同一次渲染里
 * 始终对得上列表——列表变了（换筛选、换月份）也不会拿到已经不在列表里的对象。
 */
export interface PreviewState {
  entry: Entry | null;
  open: (entry: Entry) => void;
  close: () => void;
  prev?: () => void;
  next?: () => void;
  position?: { index: number; total: number };
}

export function usePreview(list: Entry[]): PreviewState {
  const [id, setId] = useState<string | null>(null);

  const index = id ? list.findIndex((item) => item.id === id) : -1;
  const entry = index >= 0 ? list[index] : null;

  const open = useCallback((target: Entry) => setId(target.id), []);
  const close = useCallback(() => setId(null), []);

  return {
    entry,
    open,
    close,
    prev: index > 0 ? () => setId(list[index - 1].id) : undefined,
    next: index >= 0 && index < list.length - 1 ? () => setId(list[index + 1].id) : undefined,
    position: index >= 0 ? { index, total: list.length } : undefined,
  };
}
