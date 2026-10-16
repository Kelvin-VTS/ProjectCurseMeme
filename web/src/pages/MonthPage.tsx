import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Entry, MonthFile } from '../types';
import { fetchMonth } from '../lib/data';
import { byDateDesc, formatMonthLabel, isValidMonth } from '../lib/date';
import { MasonryGrid } from '../components/MasonryGrid';
import { PreviewOverlay } from '../components/PreviewOverlay';

export function MonthPage() {
  const { month } = useParams();
  const [file, setFile] = useState<MonthFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Entry | null>(null);

  useEffect(() => {
    if (!isValidMonth(month)) {
      setError(null);
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = await fetchMonth(month);
        if (!alive) return;
        setFile({
          month: data.month,
          entries: data.entries.filter((entry) => entry.visible !== false).sort(byDateDesc),
        });
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [month]);

  const closePreview = useCallback(() => setPreview(null), []);

  if (!isValidMonth(month)) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-ink-2">月份格式不对，应该是 2026-10 这种样子。</p>
        <BackHome />
      </div>
    );
  }

  const entries = file?.entries ?? [];
  const likesSum = entries.reduce((sum, entry) => sum + (entry.likes || 0), 0);

  return (
    <>
      <div className="pb-5">
        <Link
          to="/"
          className="text-[12px] font-medium text-ink-3 transition hover:text-accent"
        >
          ← 全部月份
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          {formatMonthLabel(month)}
        </h1>
        {!loading && !error && (
          <p className="mt-1 font-mono text-[12px] text-ink-3">
            收录 <span className="font-semibold text-accent">{entries.length}</span> 条 · 共{' '}
            <span className="font-semibold text-like">{likesSum}</span> 赞
          </p>
        )}
      </div>

      {loading && (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="animate-pulse rounded-2xl bg-surface-2"
              style={{ aspectRatio: index % 2 === 0 ? '3 / 4' : '4 / 3' }}
            />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <p className="text-sm font-medium text-ink">这个月份还没有数据</p>
          <p className="mt-1 font-mono text-xs break-all text-ink-3">{error}</p>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-10 text-center">
          <p className="text-sm text-ink-2">这个月还没有内容</p>
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <MasonryGrid entries={entries} onOpen={setPreview} />
      )}

      <PreviewOverlay entry={preview} onClose={closePreview} />
    </>
  );
}

function BackHome() {
  return (
    <Link
      to="/"
      className="mt-6 inline-block rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm shadow-accent/30 transition hover:bg-accent-bright"
    >
      回到首页
    </Link>
  );
}
