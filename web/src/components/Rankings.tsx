import { Link } from 'react-router-dom';
import type { RankGroup, Rankings } from '../types';
import { mediaUrl } from '../lib/data';
import { Avatar } from './Avatar';
import { HeartIcon } from './LikeButton';

/** 前三名的徽标配色，其余为中性灰 */
const RANK_BADGE = ['bg-gold text-white', 'bg-silver text-white', 'bg-bronze text-white'];

function RankPanel({
  title,
  hint,
  group,
  tone,
}: {
  title: string;
  hint: string;
  group?: RankGroup;
  tone: 'accent' | 'accent2';
}) {
  const bar = tone === 'accent' ? 'bg-accent' : 'bg-accent-2';
  const dot = tone === 'accent' ? 'text-accent' : 'text-accent-2';

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className={`h-4 w-1 rounded-full ${bar}`} />
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        <span className={`font-mono text-[11px] ${dot}`}>{hint}</span>
      </header>

      {!group || group.items.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-ink-3">还没有数据</p>
      ) : (
        <ol className="divide-y divide-line">
          {group.items.map((item, index) => (
            <li key={item.id}>
              <Link
                to={`/month/${item.month}`}
                className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-surface-2"
              >
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-lg font-mono text-[11px] font-bold ${
                    RANK_BADGE[index] ?? 'bg-surface-2 text-ink-2'
                  }`}
                >
                  {index + 1}
                </span>

                <img
                  src={mediaUrl(item.thumb)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width={48}
                  height={48}
                  className="size-12 shrink-0 rounded-xl object-cover ring-1 ring-black/5"
                />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {item.title ?? (item.kind === 'video' ? '视频' : '图片')}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-ink-3">
                    <Avatar contributor={item.contributor} size={14} />
                    <span className="truncate">{item.contributor.login}</span>
                  </span>
                </span>

                <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] font-semibold text-like">
                  <HeartIcon filled />
                  {item.likes}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function RankingsBoard({ rankings }: { rankings: Rankings }) {
  const monthGroup = rankings.monthly[0];
  const yearGroup = rankings.yearly[0];

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <RankPanel
        title="本月榜"
        hint={monthGroup?.label ?? '暂无'}
        group={monthGroup}
        tone="accent"
      />
      <RankPanel
        title="年度榜"
        hint={yearGroup?.label ?? '暂无'}
        group={yearGroup}
        tone="accent2"
      />
    </div>
  );
}
