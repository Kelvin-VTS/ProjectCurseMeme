import { useEffect, useState } from 'react';
import type { Entry } from '../types';
import { mediaUrl } from '../lib/data';
import { formatDate, formatDuration } from '../lib/date';
import { renderMarkdown } from '../lib/markdown';
import { Avatar } from './Avatar';
import { LikeButton } from './LikeButton';

/**
 * Markdown 内容的排版。项目没有装 @tailwindcss/typography，
 * 所以用任意变体在这里就地定义，避免改全局样式影响别的页面。
 */
const MD_CLASS = [
  'text-[13px] leading-6 text-ink-2',
  '[&_p]:mb-2.5 [&_p:last-child]:mb-0',
  '[&_h2]:mt-3.5 [&_h2]:mb-1.5 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-ink',
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:text-ink',
  '[&_h4]:mt-2.5 [&_h4]:mb-1 [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:text-ink',
  '[&_ul]:mb-2.5 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:mb-2.5 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:mb-1',
  '[&_blockquote]:mb-2.5 [&_blockquote]:border-l-2 [&_blockquote]:border-accent/40 [&_blockquote]:pl-3 [&_blockquote]:text-ink-3',
  '[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]',
  '[&_pre]:mb-2.5 [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:bg-surface-2 [&_pre]:p-3',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_a]:font-medium [&_a]:text-accent [&_a]:underline',
  '[&_hr]:my-3 [&_hr]:border-line',
  '[&_strong]:font-semibold [&_strong]:text-ink',
].join(' ');

/**
 * 详情预览层。
 *
 * 布局参照小红书 / 小黑盒：**媒体在左，文字说明在右侧**；
 * 窄屏（md 以下）自动改成上下堆叠。纯文字条目没有媒体，右侧面板独占。
 * 可左右切换上一条/下一条（方向键 + 顶部按钮）。
 */
export function PreviewOverlay({
  entry,
  onClose,
  onPrev,
  onNext,
  position,
}: {
  entry: Entry | null;
  onClose: () => void;
  /** 传了就启用左/右方向键和顶部按钮 */
  onPrev?: () => void;
  onNext?: () => void;
  position?: { index: number; total: number };
}) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const entryId = entry?.id;

  useEffect(() => {
    setMediaFailed(false);
  }, [entryId]);

  useEffect(() => {
    if (!entry) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft' && onPrev) onPrev();
      else if (event.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [entry, onClose, onPrev, onNext]);

  if (!entry) return null;

  const isText = entry.kind === 'text';
  const isVideo = entry.kind === 'video';
  const hasMedia = !isText && Boolean(entry.media || entry.poster);

  const bodyHtml = entry.note ? renderMarkdown(entry.note) : '';
  const hasAside = Boolean(bodyHtml || entry.title || (entry.tags && entry.tags.length > 0));

  const mediaUrlFull = entry.media ? mediaUrl(entry.media) : '';
  const posterUrl = entry.poster ? mediaUrl(entry.poster) : '';

  // 有正文的媒体条目走两栏（更宽），纯文字条目窄一点更像阅读器
  const widthClass = hasMedia && hasAside ? 'max-w-6xl' : hasMedia ? 'max-w-5xl' : 'max-w-2xl';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={entry.title ?? '预览'}
      onClick={onClose}
    >
      <div
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl ${widthClass}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
          <Avatar contributor={entry.contributor} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] leading-tight font-semibold text-ink">
              {entry.contributor.login}
              {isText && (
                <span className="ml-1.5 rounded-full bg-accent-2-soft px-1.5 py-0.5 text-[10px] align-middle font-medium text-accent-2">
                  文字
                </span>
              )}
            </p>
            <p className="truncate font-mono text-[11px] leading-tight text-ink-3">
              {formatDate(entry.date)}
              {entry.group ? ` · ${entry.group}` : ''}
              {isVideo && typeof entry.duration === 'number'
                ? ` · ${formatDuration(entry.duration)}`
                : ''}
            </p>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={!onPrev}
              aria-label="上一条"
              className="grid size-7 place-items-center rounded-full border border-line text-[13px] leading-none text-ink-2 transition hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
            >
              ‹
            </button>
            <span className="min-w-[42px] text-center font-mono text-[11px] text-ink-3">
              {position ? `${position.index + 1}/${position.total}` : ''}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={!onNext}
              aria-label="下一条"
              className="grid size-7 place-items-center rounded-full border border-line text-[13px] leading-none text-ink-2 transition hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
            >
              ›
            </button>
          </div>

          <LikeButton entry={entry} size="md" />

          {hasMedia && mediaUrlFull && (
            <a
              href={mediaUrlFull}
              download
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 transition hover:border-accent/40 hover:text-accent"
            >
              下载原文件
            </a>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 transition hover:border-accent/40 hover:text-accent"
          >
            关闭
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {hasMedia && (
            <div className="relative min-h-0 flex-1 overflow-auto bg-ink">
              {isVideo && !mediaFailed ? (
                <video
                  key={entry.id}
                  src={mediaUrlFull}
                  poster={posterUrl || undefined}
                  controls
                  autoPlay
                  playsInline
                  onError={() => setMediaFailed(true)}
                  className="mx-auto max-h-[72vh] w-full bg-black"
                />
              ) : (
                <img
                  src={isVideo ? posterUrl : mediaUrlFull}
                  alt={entry.title ?? ''}
                  className="mx-auto max-h-[72vh] w-full object-contain"
                />
              )}

              {isVideo && mediaFailed && (
                <p className="absolute inset-x-0 bottom-0 bg-accent-2-soft px-4 py-2 text-[12px] text-accent-2">
                  视频加载失败：文件可能还没同步到 CDN，稍后再试或点「下载原文件」。
                </p>
              )}
            </div>
          )}

          {hasAside && (
            <aside
              className={[
                'min-h-0 overflow-auto px-4 py-4',
                hasMedia
                  ? 'shrink-0 border-t border-line bg-surface md:w-[360px] md:border-t-0 md:border-l'
                  : 'flex-1',
              ].join(' ')}
            >
              {entry.title && (
                <h2 className="mb-2 text-[15px] leading-6 font-semibold text-ink">{entry.title}</h2>
              )}

              {bodyHtml && (
                <div
                  className={MD_CLASS}
                  // 渲染器先把文本转义、再只生成白名单标签，不会带出脚本
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
              )}

              {entry.tags && entry.tags.length > 0 && (
                <p className="mt-3 flex flex-wrap gap-1">
                  {entry.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-ink"
                    >
                      #{tag}
                    </span>
                  ))}
                </p>
              )}

              {!bodyHtml && !entry.title && (
                <p className="text-[12px] text-ink-3">这一条没有文字说明。</p>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
