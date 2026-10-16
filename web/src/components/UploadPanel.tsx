import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SITE } from '../lib/site';
import { useAccess } from '../lib/access';
import { formatBytes } from '../lib/date';
import {
  MAX_FILE_SIZE,
  WARN_FILE_SIZE,
  fetchIngestRun,
  uploadBatch,
  type BatchResult,
  type FileStatusEvent,
  type IngestRun,
} from '../lib/github';

/**
 * 站长上传面板。
 *
 * 分工：浏览器只负责把**原文件**推到 staging/<批次> 分支，
 * 转码与缩略图由 Actions 里的 process-media.ts 完成
 * —— 浏览器不能转码 HEVC，而 runner 自带 ffmpeg。
 */

type Phase = 'ready' | 'encode' | 'upload' | 'done' | 'failed';

interface QueueItem {
  key: string;
  file: File;
  phase: Phase;
  sent: number;
  total: number;
  error?: string;
}

function makeBatchId(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const salt = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${salt}`;
}

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function UploadPanel() {
  const { owner, name: repo } = SITE.repo;
  const access = useAccess();

  // 令牌状态由全局 AccessProvider 管；这里只留输入框的草稿值
  const [draftToken, setDraftToken] = useState('');

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [date, setDate] = useState(today);
  const [group, setGroup] = useState('');
  const [tags, setTags] = useState('');
  const [login, setLogin] = useState('');

  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<IngestRun | null>(null);
  const [polling, setPolling] = useState(false);

  const fileInput = useRef<HTMLInputElement | null>(null);

  // 令牌校验通过后自动把署名填上，省得手输
  useEffect(() => {
    const name = access.login;
    if (name) setLogin((current) => current || name);
  }, [access.login]);

  // 上传成功后自动盯几次运行状态，把结果直接显示在页面上。
  // 只盯 8 次就停：Actions 的运行查询是匿名接口，每次上传都无限轮询会吃掉限流额度。
  const branch = result?.branch ?? null;

  const refreshRun = useCallback(async () => {
    if (!branch) return;
    setPolling(true);
    try {
      setRun(await fetchIngestRun(owner, repo, branch));
    } catch {
      /* 查状态失败不影响主流程 */
    } finally {
      setPolling(false);
    }
  }, [branch, owner, repo]);

  useEffect(() => {
    if (!branch) {
      setRun(null);
      return;
    }
    let alive = true;
    let timer: number | undefined;
    let remaining = 8;

    const tick = async () => {
      if (!alive) return;
      setPolling(true);
      let status: IngestRun | null = null;
      try {
        status = await fetchIngestRun(owner, repo, branch);
      } catch {
        /* 静默：状态查不到不该干扰上传本身 */
      }
      if (!alive) return;
      setPolling(false);
      if (status) setRun(status);

      remaining -= 1;
      if (status?.phase === 'completed' || remaining <= 0) return;
      timer = window.setTimeout(() => void tick(), 12000);
    };

    void tick();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [branch, owner, repo]);

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    const items: QueueItem[] = [];
    for (const file of Array.from(incoming)) {
      items.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        phase: 'ready',
        sent: 0,
        total: 0,
      });
    }
    setQueue((previous) => [...previous, ...items]);
    setResult(null);
    setError(null);
  }, []);

  const onFileEvent = useCallback((event: FileStatusEvent) => {
    setQueue((previous) =>
      previous.map((item, index) =>
        index === event.index
          ? {
              ...item,
              phase: event.phase,
              sent: event.sent ?? item.sent,
              total: event.total ?? item.total,
              error: event.error,
            }
          : item,
      ),
    );
  }, []);

  const oversized = queue.filter((item) => item.file.size > MAX_FILE_SIZE);
  const hasWarning = queue.some((item) => item.file.size > WARN_FILE_SIZE);
  const ready = access.canUpload && queue.length > 0 && oversized.length === 0 && !uploading;

  const tagList = useMemo(
    () => tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
    [tags],
  );

  async function submit() {
    if (!access.canUpload) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const batch = makeBatchId();
      const outcome = await uploadBatch({
        token: access.token,
        owner,
        repo,
        files: queue.map((item) => item.file),
        meta: {
          batch,
          login: login.trim() || access.login || 'unknown',
          date,
          group: group.trim(),
          tags: tagList,
        },
        onFile: onFileEvent,
      });
      setResult(outcome);
      setQueue([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        {/* ---------------- 投放区 ---------------- */}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
          onClick={() => fileInput.current?.click()}
          className={[
            'cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition',
            dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface hover:border-accent/50',
          ].join(' ')}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <p className="text-sm font-medium text-ink">把图片 / 视频拖到这里</p>
          <p className="mt-1 text-xs text-ink-3">或者点一下选择文件 · 单文件建议不超过 30MB</p>
        </div>

        {/* ---------------- 队列 ---------------- */}
        {queue.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <header className="flex items-center gap-2 border-b border-line bg-surface-2/60 px-3 py-2">
              <span className="text-[13px] font-semibold text-ink">待上传 {queue.length} 个</span>
              {!uploading && (
                <button
                  type="button"
                  onClick={() => setQueue([])}
                  className="ml-auto text-[11px] text-ink-3 transition hover:text-like"
                >
                  清空
                </button>
              )}
            </header>
            <ul className="divide-y divide-line">
              {queue.map((item) => {
                const over = item.file.size > MAX_FILE_SIZE;
                const warn = item.file.size > WARN_FILE_SIZE;
                const percent = item.total > 0 ? Math.round((item.sent / item.total) * 100) : 0;
                return (
                  <li key={item.key} className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{item.file.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-3">
                        {formatBytes(item.file.size)}
                      </span>
                      <span
                        className={[
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                          item.phase === 'done'
                            ? 'bg-accent-2-soft text-accent-2'
                            : item.phase === 'failed' || over
                              ? 'bg-like-soft text-like'
                              : item.phase === 'upload' || item.phase === 'encode'
                                ? 'bg-accent-soft text-accent-ink'
                                : warn
                                  ? 'bg-accent-2-soft text-accent-2'
                                  : 'bg-surface-2 text-ink-3',
                        ].join(' ')}
                      >
                        {item.phase === 'done'
                          ? '已上传'
                          : item.phase === 'failed'
                            ? '失败'
                            : item.phase === 'upload'
                              ? `上传 ${percent}%`
                              : item.phase === 'encode'
                                ? '编码中'
                                : over
                                  ? '超限'
                                  : warn
                                    ? '偏大'
                                    : '待上传'}
                      </span>
                    </div>
                    {item.phase === 'upload' && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
                      </div>
                    )}
                    {item.error && <p className="mt-1 text-[11px] text-like">{item.error}</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {result && (
          <div
            className={[
              'rounded-2xl border p-4',
              runFailed(run) ? 'border-like/30 bg-like-soft' : 'border-accent-2/30 bg-accent-2-soft',
            ].join(' ')}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p
                className={[
                  'text-[13px] font-semibold',
                  runFailed(run) ? 'text-like' : 'text-accent-2',
                ].join(' ')}
              >
                {runTitle(run, polling)}
              </p>
              {!runDone(run) && (
                <button
                  type="button"
                  onClick={() => void refreshRun()}
                  disabled={polling}
                  className="rounded-lg border border-current/30 px-2 py-0.5 text-[11px] font-medium text-ink-2 transition hover:bg-surface disabled:opacity-50"
                >
                  {polling ? '查询中…' : '刷新'}
                </button>
              )}
            </div>

            <p className="mt-1 text-[12px] leading-5 text-ink-2">{runDetail(run)}</p>

            <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
              {run?.htmlUrl ? (
                <a
                  href={run.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-line px-2.5 py-1 font-medium text-ink-2 transition hover:text-ink"
                >
                  运行日志
                </a>
              ) : (
                <a
                  href={`https://github.com/${owner}/${repo}/actions`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-line px-2.5 py-1 font-medium text-ink-2 transition hover:text-ink"
                >
                  打开 Actions
                </a>
              )}
              <a
                href={result.commitUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-line px-2.5 py-1 text-ink-2 transition hover:text-ink"
              >
                这次提交
              </a>
              <span className="self-center font-mono text-[11px] text-ink-3">{result.branch}</span>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-like/30 bg-like-soft p-4">
            <p className="text-[13px] font-semibold text-like">上传失败</p>
            <p className="mt-1 font-mono text-[11px] break-all text-ink-2">{error}</p>
            <p className="mt-2 text-[11px] text-ink-2">
              常见原因：token 过期或权限不足（需要 Contents: Read and write）、文件超过 GitHub 的
              100MB 单文件上限、网络中断。
            </p>
          </div>
        )}
      </div>

      {/* ---------------- 右侧：鉴权 + 元数据 ---------------- */}
      <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-[14px] font-semibold text-ink">访问令牌</h2>
          {access.login ? (
            <div className="mt-2.5">
              <div className="flex items-center gap-2">
                {access.avatarUrl && (
                  <img src={access.avatarUrl} alt="" className="size-6 rounded-full ring-1 ring-black/10" />
                )}
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                  已连接 {access.login}
                  <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-ink">
                    {access.canEdit ? '站长' : '贡献者'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={access.disconnect}
                  className="shrink-0 text-[11px] text-ink-3 transition hover:text-like"
                >
                  断开
                </button>
              </div>
              {!access.canEdit && (
                <p className="mt-2 text-[11px] leading-4 text-accent-2">
                  贡献者身份：可以上传素材，但改不了已入库内容（点赞 / 上传者 / 下架只有站长能改）。
                </p>
              )}
            </div>
          ) : (
            <>
              <input
                type="password"
                value={draftToken}
                onChange={(event) => setDraftToken(event.target.value)}
                placeholder="github_pat_..."
                className="mt-2.5 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <button
                type="button"
                disabled={!draftToken.trim() || access.checking}
                onClick={() => void access.connect(draftToken)}
                className="mt-2 w-full rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-40"
              >
                {access.checking ? '校验中…' : '保存并校验'}
              </button>
              {access.error && <p className="mt-2 text-[11px] break-all text-like">{access.error}</p>}
            </>
          )}
          <p className="mt-2.5 text-[11px] leading-4 text-ink-3">
            需要 fine-grained token，权限只要 <b>Contents: Read and write</b>，仓库只勾{' '}
            <code className="font-mono">{owner}/{repo}</code>。令牌只存在这台浏览器的 localStorage。
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-[14px] font-semibold text-ink">本批信息</h2>
          <div className="mt-2.5 space-y-2.5">
            <Labeled label="日期（归月依据）">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={FIELD}
              />
            </Labeled>
            <Labeled label="来源 / 群名（可留空）">
              <input
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                placeholder="比如 G07"
                className={FIELD}
              />
            </Labeled>
            <Labeled label="标签（逗号分隔）">
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="抽象,搞笑"
                className={FIELD}
              />
            </Labeled>
            <Labeled label="上传者署名">
              <input
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                placeholder="GitHub 登录名"
                className={FIELD}
              />
            </Labeled>
          </div>

          <button
            type="button"
            disabled={!ready}
            onClick={() => void submit()}
            className="mt-3 w-full rounded-xl bg-accent px-3 py-2 text-[13px] font-medium text-white shadow-sm shadow-accent/30 transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-40"
          >
            {uploading ? '上传中…' : `上传 ${queue.length} 个素材`}
          </button>

          {!access.login && <p className="mt-2 text-[11px] text-ink-3">先在上面填好访问令牌。</p>}
          {access.login && !access.canUpload && (
            <p className="mt-2 text-[11px] text-like">
              这个令牌对目标仓库没有写权限，检查是否勾了 Contents: Read and write。
            </p>
          )}
          {oversized.length > 0 && (
            <p className="mt-2 text-[11px] text-like">
              有 {oversized.length} 个文件超过 {formatBytes(MAX_FILE_SIZE)}，请先压缩或改用
              <code className="font-mono"> npm run media</code> 本地入库。
            </p>
          )}
          {hasWarning && oversized.length === 0 && (
            <p className="mt-2 text-[11px] text-accent-2">
              有文件超过 {formatBytes(WARN_FILE_SIZE)}：能传，但浏览器要先 base64 编码，内存占用约为文件的 1.4 倍。
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-[14px] font-semibold text-ink">提交后会发生什么</h2>
          <ol className="mt-2.5 space-y-2 text-[12px] leading-5 text-ink-2">
            <li>
              <span className="font-mono text-accent">1.</span> 浏览器把原文件推到临时分支{' '}
              <code className="font-mono text-ink">staging/&lt;批次&gt;</code>
            </li>
            <li>
              <span className="font-mono text-accent">2.</span> Actions 被触发，用真 ffmpeg 转码
              （HEVC → H.264）、抽帧选封面、生成缩略图、按日期归月
            </li>
            <li>
              <span className="font-mono text-accent">3.</span> 成品提交到 <code className="font-mono text-ink">main</code>
              ，临时分支被删除，站点自动重新部署
            </li>
          </ol>
          <p className="mt-2 text-[11px] text-ink-3">
            同一批只要点一次。处理期间可以继续传下一批，Actions 会排队。
          </p>
        </div>
      </aside>
    </div>
  );
}

const FIELD =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] text-ink-3">{label}</span>
      {children}
    </label>
  );
}

function runDone(run: IngestRun | null): boolean {
  return run?.phase === 'completed';
}

function runFailed(run: IngestRun | null): boolean {
  return run?.phase === 'completed' && run.conclusion !== 'success';
}

function runTitle(run: IngestRun | null, polling: boolean): string {
  if (!run) return polling ? '正在查询处理状态…' : '已提交，等待 Actions 接手';
  if (run.phase === 'queued') return 'Actions 已排队，等待运行';
  if (run.phase === 'in_progress') return '正在处理：转码 / 抽帧 / 重建索引';
  if (run.conclusion === 'success') return '处理完成，站点正在重新部署';
  if (run.conclusion === 'failure') return '处理失败';
  if (run.conclusion === 'cancelled') return '这次运行被取消了';
  return '处理已结束';
}

function runDetail(run: IngestRun | null): string {
  if (!run) {
    return '刚推送分支，GitHub 通常几秒内开始调度；页面会自己刷新，也可以点「刷新」手动查。';
  }
  if (run.phase === 'queued' || run.phase === 'in_progress') {
    return '通常 1–2 分钟：先装依赖，再用 ffmpeg 转码抽帧，最后重建索引。完成后这里会自动更新。';
  }
  if (run.conclusion === 'success') {
    return '新条目已提交到 main，约 1 分钟后刷新首页就能看到。';
  }
  if (run.conclusion === 'failure') {
    return '点「运行日志」看失败原因（常见是文件损坏、或编码读不出来）。临时分支会保留方便排查，修好后重新上传即可。';
  }
  return `运行状态：${run.conclusion ?? '未知'}。可以点「运行日志」看细节。`;
}
