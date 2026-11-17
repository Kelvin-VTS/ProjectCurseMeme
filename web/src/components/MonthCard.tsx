import { Link } from 'react-router-dom';
import type { MonthSummary } from '../types';
import { mediaUrl } from '../lib/data';
import { formatDateShort, formatMonthLabel } from '../lib/date';

export function MonthCard({ item }: { item: MonthSummary }) {
  return (
    <Link
      to={`/month/${item.month}`}
      className="group block overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
        {item.cover ? (
          <img
            src={mediaUrl(item.cover)}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          /* 整月只有文字记录时没有封面，用渐变占位，不留破图 */
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-accent-soft to-accent-2-soft">
            <span className="text-[11px] font-medium text-accent-2">只有文字记录</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-3.5">
          <p className="text-[15px] font-semibold text-white">{formatMonthLabel(item.month)}</p>
          <p className="mt-0.5 text-[11px] text-white/80">
            收录 <span className="font-mono font-semibold text-white">{item.count}</span> 条 · 最新{' '}
            <span className="font-mono">{formatDateShort(item.latest)}</span>
          </p>
        </div>
      </div>
    </Link>
  );
}
