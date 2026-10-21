import { useEffect, useState } from 'react';
import type { Entry } from '../types';
import { mediaUrl } from '../lib/data';
import { formatDate, formatDuration } from '../lib/date';
import { Avatar } from './Avatar';
import { LikeButton } from './LikeButton';

/**
 * 详情预览层：图片看全、视频能播、来源信息对，可左右切换上一条/下一条。
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
  /** 传了就启用左/右方向键和两侧按钮 */
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

  const isVideo = entry.kind === 'video';
  const downloadUrl = mediaUrl(entry.media);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={entry.title ?? '预览'}
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Avatar contributor={entry.contributor} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] leading-tight font-semibold text-ink">
              {entry.contributor.login}
            </p>
            <p className="truncate font-mono text-[11px] leading-tight text-ink-3">
              {formatDate(entry.date)}
              {entry.group ? ` · ${entry.group}` : ''}
              {isVideo && typeof entry.duration === 'number'
                ? ` · ${formatDuration(entry.duration)}`
                : ''}
              {position ? ` · ${position.index + 1}/${position.total}` : ''}
            </p>
          </div>

          <LikeButton entry={entry} size="md" />

          <a
            href={downloadUrl}
            download
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 transition hover:border-accent/40 hover:text-accent"
          >
            下载原文件
          </a>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 transition hover:border-accent/40 hover:text-accent"
          >
            关闭
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-auto bg-ink">
          {onPrev && (
            <button
              type="button"
              onClick={onPrev}
              aria-label="上一条"
              className="absolute top-1/2 left-2 z-10 -translate-y-1/2 rounded-full bg-black/50 px-3 py-4 text-lg leading-none text-white/90 backdrop-blur transition hover:bg-black/70"
            >
              ‹
            </button>
          )}
          {onNext && (
            <button
              type="button"
              onClick={onNext}
              aria-label="下一条"
              className="absolute top-1/2 right-2 z-10 -translate-y-1/2 rounded-full bg-black/50 px-3 py-4 text-lg leading-none text-white/90 backdrop-blur transition hover:bg-black/70"
            >
              ›
            </button>
          )}

          {isVideo && !mediaFailed ? (
            <video
              key={entry.id}
              src={downloadUrl}
              poster={mediaUrl(entry.poster)}
              controls
              autoPlay
              playsInline
              onError={() => setMediaFailed(true)}
              className="mx-auto max-h-[72vh] w-full bg-black"
            />
          ) : (
            <img
              src={mediaUrl(isVideo ? entry.poster : entry.media)}
              alt={entry.title ?? ''}
              className="mx-auto max-h-[72vh] w-full object-contain"
            />
          )}
        </div>

        {(entry.title || entry.note || (entry.tags && entry.tags.length > 0)) && (
          <footer className="space-y-1.5 border-t border-line px-4 py-3">
            {entry.title && <p className="text-[14px] font-medium text-ink">{entry.title}</p>}
            {entry.tags && entry.tags.length > 0 && (
              <p className="flex flex-wrap gap-1">
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
            {entry.note && <p className="text-[12px] text-ink-2">{entry.note}</p>}
          </footer>
        )}

        {isVideo && mediaFailed && (
          <p className="border-t border-line bg-accent-2-soft px-4 py-2 text-[12px] text-accent-2">
            示例数据里没有真实视频文件；接入处理管线后这里会播放转码好的 H.264 视频。
          </p>
        )}
      </div>
    </div>
  );
}
