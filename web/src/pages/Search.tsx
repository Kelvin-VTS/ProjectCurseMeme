import { useEffect, useMemo, useState } from 'react';
import type { Entry, SearchEntry, SearchIndex } from '../types';
import { fetchSearch } from '../lib/data';
import { formatMonthLabel } from '../lib/date';
import { usePreview } from '../lib/preview';
import { MasonryGrid } from '../components/MasonryGrid';
import { PreviewOverlay } from '../components/PreviewOverlay';

type KindFilter = 'all' | 'image' | 'video';
type SortKey = 'new' | 'likes';

/**
 * search.json 里的条目不带 hash / size / mime / via / visible ——
 * 这些字段只服务于入库流程，渲染卡片一个都用不到。
 * 这里补上占位值来满足 Entry 的类型契约，它们不会被读。
 */
function toEntry(item: SearchEntry): Entry {
  return {
    ...item,
    createdAt: item.date,
    poster: item.poster ?? item.thumb,
    size: 0,
    mime: '',
    hash: item.id,
    via: 'cli',
    visible: true,
  };
}

/** 参与关键词匹配的字段：用户能想到的都放进来 */
function haystackOf(item: SearchEntry): string {
  return [item.title, item.note, item.group, item.contributor.login, item.date, item.id, ...(item.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function Search() {
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [month, setMonth] = useState('all');
  const [sort, setSort] = useState<SortKey>('new');

  useEffect(() => {
    let alive = true;
    fetchSearch()
      .then((data) => {
        if (alive) setIndex(data);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const source = index?.entries;

  // 月份下拉的选项来自数据本身，不写死
  const months = useMemo(() => {
    if (!source) return [];
    return [...new Set(source.map((item) => item.month))].sort((a, b) => (a < b ? 1 : -1));
  }, [source]);

  const results = useMemo(() => {
    if (!source) return [];
    const needle = query.trim().toLowerCase();

    const filtered = source.filter((item) => {
      if (kind !== 'all' && item.kind !== kind) return false;
      if (month !== 'all' && item.month !== month) return false;
      if (!needle) return true;
      return haystackOf(item).includes(needle);
    });

    // source 本身按日期倒序；sort 是稳定排序，同赞数自然保持日期顺序
    const sorted = sort === 'likes' ? [...filtered].sort((a, b) => b.likes - a.likes) : filtered;
    return sorted.map(toEntry);
  }, [source, query, kind, month, sort]);

  const preview = usePreview(results);

  const filtering = Boolean(query.trim()) || kind !== 'all' || month !== 'all';

  function reset() {
    setQuery('');
    setKind('all');
    setMonth('all');
  }

  return (
    <>
      <header className="pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">搜索</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          在全部归档里按关键词、类型、月份筛选。点开任意一条可以用左右方向键连续翻。
        </p>
      </header>

      <section className="rounded-2xl border border-line bg-surface p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜标题、标签、说明、上传者、群名、日期…"
            className="min-w-[200px] flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />

          <div className="flex rounded-xl border border-line p-0.5">
            {(
              [
                ['all', '全部'],
                ['image', '图片'],
                ['video', '视频'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setKind(key)}
                className={[
                  'rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition',
                  kind === key ? 'bg-accent text-white' : 'text-ink-3 hover:text-ink',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
          >
            <option value="all">全部月份</option>
            {months.map((value) => (
              <option key={value} value={value}>
                {formatMonthLabel(value)}
              </option>
            ))}
          </select>

          <div className="flex rounded-xl border border-line p-0.5">
            {(
              [
                ['new', '最新'],
                ['likes', '最多赞'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                className={[
                  'rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition',
                  sort === key ? 'bg-accent text-white' : 'text-ink-3 hover:text-ink',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {filtering && (
            <button
              type="button"
              onClick={reset}
              className="rounded-lg px-2 py-1.5 text-[11px] text-ink-3 transition hover:text-like"
            >
              清除筛选
            </button>
          )}
        </div>

        <p className="mt-2 text-[11px] text-ink-3">
          {error
            ? '搜索索引加载失败'
            : index
              ? `全部 ${index.total} 条 · 符合条件 ${results.length} 条`
              : '正在加载搜索索引…'}
        </p>
      </section>

      {error && (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <p className="text-sm font-medium text-ink">索引加载失败</p>
          <p className="mt-1 font-mono text-[11px] break-all text-ink-3">{error}</p>
          <p className="mt-3 text-[12px] text-ink-2">
            搜索索引由 <code className="font-mono text-ink">scripts/build-index.mjs</code> 生成
            （<code className="font-mono text-ink">data/search.json</code>）。
            部署后才有这个文件；本地开发时先跑一次 <code className="font-mono text-ink">npm run index</code>。
          </p>
        </div>
      )}

      {!error && index && results.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-line-strong bg-surface p-10 text-center">
          <p className="text-sm text-ink-2">
            {index.total === 0 ? '还没有任何内容' : '没有符合条件的条目'}
          </p>
          {index.total > 0 && (
            <button
              type="button"
              onClick={reset}
              className="mt-4 rounded-xl border border-line px-4 py-2 text-[13px] text-ink-2 transition hover:border-accent/50 hover:text-accent"
            >
              清除筛选
            </button>
          )}
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-6">
          <MasonryGrid entries={results} onOpen={preview.open} />
        </div>
      )}

      <PreviewOverlay
        entry={preview.entry}
        onClose={preview.close}
        onPrev={preview.prev}
        onNext={preview.next}
        position={preview.position}
      />
    </>
  );
}
