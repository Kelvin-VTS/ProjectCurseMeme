import type { Entry } from '../types';
import { mediaUrl } from '../lib/data';
import { formatDateShort, formatDuration } from '../lib/date';
import { excerpt } from '../lib/markdown';
import { Avatar } from './Avatar';
import { LikeButton } from './LikeButton';

/**
 * 网格卡片。两种形态：
 *
 *  媒体条目（图片 / 视频）
 *    上传者  →  媒体（可点开预览）  →  标题 / **正文摘要** / 标签 / 点赞 · 日期
 *
 *  文字条目（kind === 'text'）
 *    上传者  →  **正文本身（截断）**  →  标题 / 标签 / 点赞 · 日期
 *
 * 三个关键约束：
 *  1. 视频卡片**不渲染 <video>**，只渲染首帧海报 + 播放角标，
 *     否则一屏二十个视频会同时发请求，手机端直接卡死。
 *  2. 点赞是卡片内的独立 <button>，所以卡片外层不能用 <button> 包起来
 *     （HTML 不允许按钮嵌套，点击也会互相吞掉）。
 *  3. 卡片底部的摘要走 plainText（去掉 Markdown 标记）——
 *     卡片里不该出现 ### 或 ** 这种原始符号。
 */
export function MediaCard({
  entry,
  onOpen,
}: {
  entry: Entry;
  onOpen: (entry: Entry) => void;
}) {
  const isText = entry.kind === 'text';
  const isVideo = entry.kind === 'video';
  const label = entry.title ?? (isText ? '文字' : isVideo ? '视频' : '图片');

  // 媒体卡片的摘要要短；文字卡片本身就是正文，给更多字数
  const summary = entry.note ? excerpt(entry.note, isText ? 300 : 140) : '';
  const ratio =
    entry.width && entry.height && entry.width > 0
      ? { width: entry.width, height: entry.height }
      : { width: 4, height: 3 };

  return (
    <article className="group overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10">
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <Avatar contributor={entry.contributor} size={20} />
        <span className="truncate text-[12px] font-medium text-ink-2">
          {entry.contributor.login}
        </span>
        {isVideo && (
          <span className="ml-auto shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent-ink">
            视频
          </span>
        )}
        {isText && (
          <span className="ml-auto shrink-0 rounded-full bg-accent-2-soft px-2 py-0.5 text-[10px] font-medium text-accent-2">
            文字
          </span>
        )}
      </header>

      <button
        type="button"
        onClick={() => onOpen(entry)}
        aria-label={`查看${label}，${formatDateShort(entry.date)}`}
        className="block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {isText ? (
          /* 文字条目：没有图，正文直接当主体 */
          <div className="relative w-full bg-surface-2 px-3.5 py-3.5">
            <p className="line-clamp-8 text-[13px] leading-6 whitespace-pre-wrap text-ink-2">
              {summary || '（没有正文）'}
            </p>
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-surface-2 to-transparent" />
          </div>
        ) : (
          <div
            className="relative w-full overflow-hidden bg-surface-2"
            style={{ aspectRatio: `${ratio.width} / ${ratio.height}` }}
          >
            {entry.thumb ? (
              <img
                src={mediaUrl(entry.thumb)}
                alt=""
                loading="lazy"
                decoding="async"
                width={ratio.width}
                height={ratio.height}
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-[11px] text-ink-3">
                缩略图缺失
              </div>
            )}

            {isVideo && (
              <>
                <span className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span className="grid size-11 place-items-center rounded-full bg-accent/90 shadow-lg shadow-accent/30 ring-2 ring-white/70 transition duration-200 group-hover:scale-110">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 translate-x-[1px] fill-white">
                      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                    </svg>
                  </span>
                </span>
                {typeof entry.duration === 'number' && (
                  <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-white">
                    {formatDuration(entry.duration)}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </button>

      <div className="space-y-1.5 px-3 pt-2.5 pb-3">
        {entry.title && (
          <p className="line-clamp-2 text-[13px] leading-5 font-medium text-ink">{entry.title}</p>
        )}

        {/* 媒体卡片的正文摘要：小红书那种「图下面跟一段字」 */}
        {!isText && summary && (
          <p className="line-clamp-3 text-[12px] leading-5 text-ink-2">{summary}</p>
        )}

        {entry.tags && entry.tags.length > 0 && (
          <p className="flex flex-wrap gap-1">
            {entry.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] leading-4 font-medium text-accent-ink"
              >
                #{tag}
              </span>
            ))}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <LikeButton entry={entry} />
          <span className="truncate text-right font-mono text-[11px] text-ink-3">
            {entry.group ? `${entry.group} · ` : ''}
            {formatDateShort(entry.date)}
          </span>
        </div>
      </div>
    </article>
  );
}
