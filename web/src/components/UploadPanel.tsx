import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SITE } from '../lib/site';
import { formatBytes } from '../lib/date';
import {
  LOGIN_KEY,
  MAX_FILE_SIZE,
  TOKEN_KEY,
  WARN_FILE_SIZE,
  uploadBatch,
  verifyAccess,
  type Access,
  type BatchResult,
  type FileStatusEvent,
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

  const [token, setToken] = useState('');
  const [savedToken, setSavedToken] = useState('');
  const [access, setAccess] = useState<Access | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [date, setDate] = useState(today);
  const [group, setGroup] = useState('');
  const [tags, setTags] = useState('');
  const [login, setLogin] = useState('');

  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement | null>(null);

  // 进页面就把存过的 token 拿出来验一次，省得每次手输
  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY) ?? '';
    if (!stored) return;
    setSavedToken(stored);
    setToken(stored);
    setLogin(window.localStorage.getItem(LOGIN_KEY) ?? '');
  }, []);

  const check = useCallback(
    async (candidate: string) => {
      setChecking(true);
      setCheckError(null);
      try {
        const info = await verifyAccess(candidate, owner, repo);
        setAccess(info);
        setLogin((current) => current || info.login);
        window.localStorage.setItem(TOKEN_KEY, candidate);
        window.localStorage.setItem(LOGIN_KEY, info.login);
        setSavedToken(candidate);
      } catch (err) {
        setAccess(null);
        setCheckError(err instanceof Error ? err.message : String(err));
      } finally {
        setChecking(false);
      }
    },
    [owner, repo],
  );

  // token 从本地恢复后自动校验一次
  useEffect(() => {
    if (savedToken && !access && !checking && !checkError) void check(savedToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedToken]);

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
  const ready = Boolean(access?.canPush) && queue.length > 0 && oversized.length === 0 && !uploading;

  const tagList = useMemo(
    () => tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
    [tags],
  );

  async function submit() {
    if (!access) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const batch = makeBatchId();
      const outcome = await uploadBatch({
        token: savedToken,
        owner,
        repo,
        files: queue.map((item) => item.file),
        meta: { batch, login: login.trim() || access.login, date, group: group.trim(), tags: tagList },
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
          <div className="rounded-2xl border border-accent-2/30 bg-accent-2-soft p-4">
            <p className="text-[13px] font-semibold text-accent-2">已提交，Actions 正在处理</p>
            <p className="mt-1 text-[12px] leading-5 text-ink-2">
              分支 <code className="font-mono text-ink">{result.branch}</code> 已推送，
              runner 会用 ffmpeg 转码并重建索引，通常 1–2 分钟。
              完成后刷新首页即可看到新条目。
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
              <a
                href={`https://github.com/${owner}/${repo}/actions/workflows/ingest.yml`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-accent-2/40 px-2.5 py-1 font-medium text-accent-2 transition hover:bg-accent-2/10"
              >
                查看处理进度
              </a>
              <a
                href={result.commitUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-line px-2.5 py-1 text-ink-2 transition hover:text-ink"
              >
                这次提交
              </a>
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
          {access ? (
            <div className="mt-2.5 flex items-center gap-2">
              <img src={access.avatarUrl} alt="" className="size-6 rounded-full ring-1 ring-black/10" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink">已连接 {access.login}</span>
              <button
                type="button"
                onClick={() => {
                  window.localStorage.removeItem(TOKEN_KEY);
                  window.localStorage.removeItem(LOGIN_KEY);
                  setAccess(null);
                  setSavedToken('');
                  setToken('');
                }}
                className="shrink-0 text-[11px] text-ink-3 transition hover:text-like"
              >
                断开
              </button>
            </div>
          ) : (
            <>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="github_pat_..."
                className="mt-2.5 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <button
                type="button"
                disabled={!token.trim() || checking}
                onClick={() => void check(token.trim())}
                className="mt-2 w-full rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-40"
              >
                {checking ? '校验中…' : '保存并校验'}
              </button>
              {checkError && <p className="mt-2 text-[11px] break-all text-like">{checkError}</p>}
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

          {!access && <p className="mt-2 text-[11px] text-ink-3">先在上面填好访问令牌。</p>}
          {access && !access.canPush && (
            <p className="mt-2 text-[11px] text-like">
              这个令牌对 {access.repoFullName} 没有写权限，检查是否勾了 Contents: Read and write。
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
