import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entry } from '../types';
import { MediaCard } from './MediaCard';

const GAP = 14;

/** 断点：手机 2 列 → 平板 3 列 → 桌面 4 列 → 宽屏 5 列 */
function columnsForWidth(width: number): number {
  if (width < 560) return 2;
  if (width < 900) return 3;
  if (width < 1280) return 4;
  return 5;
}

/**
 * 卡片里除图片以外部分的高度估算（px），参与分列时的高度累计。
 * 卡片结构变了（新增上传者行和点赞行）就要同步改这里，否则列高会算歪。
 *   上传者行 ≈ 34 + 底部信息（内边距 + 点赞行）≈ 52
 */
function estimateMetaHeight(entry: Entry): number {
  let height = 86;
  if (entry.title) height += 20;
  if (entry.tags && entry.tags.length > 0) height += 24;
  return height;
}

/**
 * 瀑布流：按「当前最短列」插入，而不是 CSS columns。
 * CSS columns 是列优先排版，条目顺序会被打乱；而我们要保证时间倒序可读。
 *
 * 零抖动的前提是每条 Entry 都存了 width/height —— 容器先按 aspect-ratio 占好位，
 * 图片后到也不会把后面的内容顶下去。
 */
export function MasonryGrid({
  entries,
  onOpen,
}: {
  entries: Entry[];
  onOpen: (entry: Entry) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState({ width: 1280, columns: 4 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const width = el.clientWidth || 1280;
      setLayout({ width, columns: columnsForWidth(width) });
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = useMemo(() => {
    const count = layout.columns;
    const columnWidth = Math.max(80, (layout.width - GAP * (count - 1)) / count);
    const heights = new Array<number>(count).fill(0);
    const buckets: Entry[][] = Array.from({ length: count }, () => [] as Entry[]);

    for (const entry of entries) {
      let target = 0;
      for (let i = 1; i < count; i += 1) {
        if (heights[i] < heights[target]) target = i;
      }
      buckets[target].push(entry);
      const ratio = entry.width > 0 ? entry.height / entry.width : 1;
      heights[target] += ratio * columnWidth + estimateMetaHeight(entry);
    }
    return buckets;
  }, [entries, layout]);

  if (entries.length === 0) return null;

  return (
    <div ref={ref} className="flex items-start" style={{ gap: GAP }}>
      {columns.map((bucket, index) => (
        <div key={index} className="flex min-w-0 flex-1 flex-col" style={{ gap: GAP }}>
          {bucket.map((entry) => (
            <MediaCard key={entry.id} entry={entry} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  );
}
