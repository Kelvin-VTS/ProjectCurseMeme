import { useEffect, useState } from 'react';
import type { Entry } from '../types';
import { mediaUrl } from '../lib/data';
import { formatDate, formatDuration } from '../lib/date';
import { Avatar } from './Avatar';
import { LikeButton } from './LikeButton';

/**
 * 最小可用预览层。
 * 完整的详情弹窗（左右切换上一条/下一条）留到后续版本，
 * 这里只用来确认「图片能看全、视频能播、来源信息对」。
 */
export function PreviewOverlay({
  entry,
  onClose,
}: {
  entry: Entry | null;
  onClose: () => void;
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
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [entry, onClose]);

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

        <div className="min-h-0 flex-1 overflow-auto bg-ink">
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
