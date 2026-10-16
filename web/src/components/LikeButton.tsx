import { useLikes } from '../lib/likes';

export function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5">
      <path
        d="M12 20.4 5.1 13.5a4.7 4.7 0 0 1 6.6-6.7l.3.3.3-.3a4.7 4.7 0 0 1 6.6 6.7L12 20.4Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 点赞按钮。
 *
 * 数字 = 仓库 JSON 里的 likes（站长维护） + 本机是否点亮。
 * 点亮的记录只存在本机 localStorage，所以不同人看到的数字可能差 1。
 */
export function LikeButton({
  entry,
  size = 'sm',
}: {
  entry: { id: string; likes: number };
  size?: 'sm' | 'md';
}) {
  const { isLiked, toggle, displayCount } = useLikes();
  const active = isLiked(entry.id);

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? '取消点赞' : '点赞'}
      title={active ? '已点亮（记录在本机）' : '点亮（记录在本机，计数由站长维护）'}
      onClick={(event) => {
        event.stopPropagation();
        toggle(entry.id);
      }}
      className={[
        'inline-flex items-center gap-1 rounded-full border font-medium transition',
        size === 'md' ? 'px-3 py-1.5 text-[13px]' : 'px-2 py-1 text-[11px]',
        active
          ? 'border-like/30 bg-like-soft text-like'
          : 'border-line bg-surface text-ink-2 hover:border-like/40 hover:text-like',
      ].join(' ')}
    >
      <HeartIcon filled={active} />
      <span className="font-mono tabular-nums">{displayCount(entry)}</span>
    </button>
  );
}
