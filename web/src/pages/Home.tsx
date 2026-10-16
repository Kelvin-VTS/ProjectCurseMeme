import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Entry, Manifest, Rankings } from '../types';
import { fetchManifest, fetchMonth, fetchRankings } from '../lib/data';
import { byDateDesc } from '../lib/date';
import { SITE } from '../lib/site';
import { MasonryGrid } from '../components/MasonryGrid';
import { MonthCard } from '../components/MonthCard';
import { PreviewOverlay } from '../components/PreviewOverlay';
import { RankingsBoard } from '../components/Rankings';

const LATEST_COUNT = 12;

export function Home() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [rankings, setRankings] = useState<Rankings | null>(null);
  const [latest, setLatest] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Entry | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        // 榜单缺失不算致命错误，拿不到就整块隐藏
        const [data, ranks] = await Promise.all([
          fetchManifest(),
          fetchRankings().catch(() => null),
        ]);
        if (!alive) return;

        setManifest(data);
        setRankings(ranks);

        // 最新添加 = 最新月份里的前 N 条，只多发一个请求
        const newest = data.months[0];
        if (newest) {
          const file = await fetchMonth(newest.month);
          if (!alive) return;
          setLatest(
            file.entries
              .filter((entry) => entry.visible !== false)
              .sort(byDateDesc)
              .slice(0, LATEST_COUNT),
          );
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const closePreview = useCallback(() => setPreview(null), []);

  return (
    <>
      <section className="pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {SITE.name}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          {SITE.tagline}。按月份归档，视频点开即播。
        </p>
      </section>

      {loading && <SkeletonBlocks />}

      {!loading && error && (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <p className="text-sm font-medium text-ink">数据加载失败</p>
          <p className="mt-1 font-mono text-xs break-all text-ink-3">{error}</p>
          <p className="mt-3 text-xs text-ink-2">
            数据地址是 <code className="font-mono text-ink">{import.meta.env.BASE_URL}data</code>
            （由 <code className="font-mono text-ink">import.meta.env.BASE_URL</code> 推导）。
            线上 404 通常是数据基址没跟上部署子路径，检查{' '}
            <code className="font-mono text-ink">VITE_BASE</code> 与{' '}
            <code className="font-mono text-ink">VITE_DATA_BASE</code>；
            本地 404 则确认开发服务器是在 <code className="font-mono text-ink">web/</code> 目录下启动的。
          </p>
        </div>
      )}

      {!loading && !error && manifest && (
        <>
          <StatsBar manifest={manifest} />

          {manifest.total === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-line-strong bg-surface p-10 text-center">
              <p className="text-sm text-ink-2">还没有任何内容</p>
              <Link
                to="/admin"
                className="mt-4 inline-block rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm shadow-accent/30 transition hover:bg-accent-bright"
              >
                去上传
              </Link>
            </div>
          ) : (
            <>
              {rankings && (rankings.monthly.length > 0 || rankings.yearly.length > 0) && (
                <section className="pt-6">
                  <SectionHeading title="排行榜" hint="按点赞数" />
                  <RankingsBoard rankings={rankings} />
                </section>
              )}

              {latest.length > 0 && (
                <section className="pt-8">
                  <SectionHeading title="最近添加" hint={`最新 ${latest.length} 条`} />
                  <MasonryGrid entries={latest} onOpen={setPreview} />
                </section>
              )}

              {manifest.months.length > 0 && (
                <section className="pt-8">
                  <SectionHeading title="按月份" hint={`${manifest.months.length} 个月份`} />
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {manifest.months.map((item) => (
                      <MonthCard key={item.month} item={item} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      <PreviewOverlay entry={preview} onClose={closePreview} />
    </>
  );
}

/** 主页状态栏 */
function StatsBar({ manifest }: { manifest: Manifest }) {
  const stats = [
    { label: '总条目', value: manifest.total, tone: 'text-accent' },
    { label: '月份', value: manifest.months.length, tone: 'text-accent-2' },
    { label: '总点赞', value: manifest.totalLikes ?? 0, tone: 'text-like' },
    { label: '最近更新', value: manifest.months[0]?.latest ?? '—', tone: 'text-ink' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm"
        >
          <p className="text-[11px] text-ink-3">{stat.label}</p>
          <p className={`mt-0.5 font-mono text-[18px] leading-tight font-semibold ${stat.tone}`}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <span className="h-px flex-1 bg-gradient-to-r from-line-strong to-transparent" />
      {hint && <span className="font-mono text-[11px] text-ink-3">{hint}</span>}
    </div>
  );
}

function SkeletonBlocks() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-[68px] animate-pulse rounded-2xl bg-surface-2" />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="animate-pulse rounded-2xl bg-surface-2"
            style={{ aspectRatio: index % 3 === 0 ? '3 / 4' : '4 / 3' }}
          />
        ))}
      </div>
    </>
  );
}
