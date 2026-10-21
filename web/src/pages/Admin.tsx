import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Entry, MonthFile } from '../types';
import { fetchManifest, fetchMonth, mediaUrl } from '../lib/data';
import { formatMonthLabel } from '../lib/date';
import { Avatar } from '../components/Avatar';
import { UploadPanel } from '../components/UploadPanel';
import { useAccess } from '../lib/access';
import { SITE } from '../lib/site';
import { commitTextFiles, fetchIngestRun, type IngestRun } from '../lib/github';
import { Link } from 'react-router-dom';

/**
 * 站长页，两个页签：
 *
 * **上传** —— 拖入素材，浏览器用 PAT 把它们推到临时分支 staging/<批次>，
 * 由 Actions 用真 ffmpeg 处理（浏览器不能转码 HEVC）。见 components/UploadPanel.tsx。
 *
 * **编辑** —— 改上传者 / 点赞数 / 标题 / 标签 / 可见性，导出 JSON 覆盖仓库文件。
 * 之所以还是「导出」而不是直接提交：这些改动发生在已入库的月份 JSON 上，
 * 直接提交需要重算 manifest 与榜单，交给 Actions 更稳妥（后续可加一键提交）。
 */

interface Draft {
  likes?: number;
  login?: string;
  title?: string;
  tags?: string;
  visible?: boolean;
}

type DraftMap = Record<string, Draft>;

function applyDrafts(entries: Entry[], drafts: DraftMap): Entry[] {
  return entries.map((entry) => {
    const draft = drafts[entry.id];
    if (!draft) return entry;

    const next: Entry = { ...entry, contributor: { ...entry.contributor } };

    if (draft.likes !== undefined && Number.isFinite(draft.likes)) {
      next.likes = Math.max(0, Math.round(draft.likes));
    }
    if (draft.login !== undefined) {
      const login = draft.login.trim();
      if (login) next.contributor.login = login;
    }
    if (draft.title !== undefined) {
      const title = draft.title.trim();
      if (title) next.title = title;
      else delete next.title;
    }
    if (draft.tags !== undefined) {
      const tags = draft.tags
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (tags.length > 0) next.tags = tags;
      else delete next.tags;
    }
    if (draft.visible !== undefined) next.visible = draft.visible;

    return next;
  });
}

interface OutputFile {
  name: string;
  path: string;
  changed: boolean;
  json: unknown;
}

function buildOutputs(files: MonthFile[], drafts: DraftMap): OutputFile[] {
  return files.map((file) => {
    const entries = applyDrafts(file.entries, drafts);
    return {
      name: `${file.month}.json`,
      path: `web/public/data/months/${file.month}.json`,
      changed: JSON.stringify(entries) !== JSON.stringify(file.entries),
      json: { month: file.month, entries },
    };
  });
}

function downloadJson(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

const TABS: ReadonlyArray<readonly ['upload' | 'edit', string]> = [
  ['upload', '上传'],
  ['edit', '编辑'],
];

export function Admin() {
  const access = useAccess();

  const [files, setFiles] = useState<MonthFile[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'upload' | 'edit'>('upload');

  // 一键提交：只推改动的月份 JSON，派生文件交给 Actions 重建
  const [editPhase, setEditPhase] = useState<'idle' | 'submitting' | 'done' | 'failed'>('idle');
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [editRun, setEditRun] = useState<IngestRun | null>(null);
  const editTimer = useRef<number | null>(null);

  // 编辑能力只归站长：贡献者就算手动把 state 切到 edit，也会被拉回上传
  const effectiveTab: 'upload' | 'edit' = access.canEdit ? tab : 'upload';

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const manifest = await fetchManifest();
        const loaded = await Promise.all(manifest.months.map((item) => fetchMonth(item.month)));
        if (!alive) return;
        setFiles(loaded);
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

  const outputs = useMemo(() => buildOutputs(files, drafts), [files, drafts]);
  const changedOutputs = outputs.filter((output) => output.changed);
  const selected = changedOutputs.find((output) => output.name === selectedName) ?? changedOutputs[0];
  const selectedText = selected ? `${JSON.stringify(selected.json, null, 2)}\n` : '';
  const changedCount = changedOutputs.reduce((sum, output) => {
    const original = files.find((file) => `${file.month}.json` === output.name);
    if (!original) return sum;
    const applied = (output.json as { entries: Entry[] }).entries;
    return sum + applied.filter((entry, index) => JSON.stringify(entry) !== JSON.stringify(original.entries[index])).length;
  }, 0);

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  }

  const canSubmit =
    access.canEdit && access.token !== '' && changedOutputs.length > 0 && editPhase !== 'submitting';

  /** 提交后盯几次重建进度，把结果直接显示出来（最多 8 次，避免吃掉匿名接口限流） */
  function pollEditRun(branch: string, attempts = 8) {
    let left = attempts;
    const tick = async () => {
      try {
        const run = await fetchIngestRun(SITE.repo.owner, SITE.repo.name, branch);
        if (run) setEditRun(run);
        if (run?.phase === 'completed') {
          const ok = run.conclusion === 'success';
          setEditPhase(ok ? 'done' : 'failed');
          setEditMessage(
            ok
              ? '重建完成，站点正在重新部署——约 1 分钟后刷新首页即可看到。'
              : '重建失败，点下面的「查看重建进度」看日志。',
          );
          return;
        }
      } catch {
        /* 状态查不到不影响提交本身 */
      }
      left -= 1;
      if (left > 0) editTimer.current = window.setTimeout(() => void tick(), 12000);
    };
    void tick();
  }

  async function submitEdits() {
    if (!canSubmit) return;
    setEditPhase('submitting');
    setEditMessage(null);
    setEditRun(null);

    const branch = `edit/${Date.now().toString(36)}`;
    try {
      await commitTextFiles({
        token: access.token,
        owner: SITE.repo.owner,
        repo: SITE.repo.name,
        branch,
        message: `edit: 站长修改 ${changedOutputs.length} 个月份文件`,
        files: changedOutputs.map((output) => ({
          path: output.path,
          text: `${JSON.stringify(output.json, null, 2)}\n`,
        })),
      });
      setDrafts({});
      setEditPhase('done');
      setEditMessage(`已推到 ${branch}，正在重建索引…`);
      pollEditRun(branch);
    } catch (err) {
      setEditPhase('failed');
      setEditMessage(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(
    () => () => {
      if (editTimer.current) window.clearTimeout(editTimer.current);
    },
    [],
  );

  // 未登录：这一页只做引导。登录有自己的页面，不该在这里再塞一个表单。
  if (access.checking && !access.login) {
    return (
      <div className="mx-auto max-w-md pt-10 text-center text-[12px] text-ink-3">
        正在校验登录状态…
      </div>
    );
  }

  if (!access.canUpload) {
    return (
      <div className="mx-auto max-w-md pt-4 sm:pt-10">
        <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-sm">
          <p className="text-[15px] font-semibold text-ink">这个页面需要登录</p>
          <p className="mt-2 text-[12px] leading-5 text-ink-2">
            上传素材、修改已入库内容，都需要先把这台设备绑定到一个访问令牌上。
            如果你只是来投稿，其实不用登录。
          </p>
          <div className="mt-4 space-y-2">
            <Link
              to="/login"
              className="block rounded-xl bg-accent py-2.5 text-[13px] font-medium text-white shadow-sm shadow-accent/30 transition hover:bg-accent-bright"
            >
              去登录
            </Link>
            <Link
              to="/guide"
              className="block rounded-xl border border-line py-2.5 text-[12px] font-medium text-ink-2 transition hover:border-accent/40 hover:text-accent"
            >
              用投稿表单（不需要登录）
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <header className="pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">上传 / 管理</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-2">
          <span className="font-medium text-ink">上传</span>：拖入素材，浏览器把它们推到临时分支，
          Actions 用真 ffmpeg 转码后写回仓库——这样 HEVC 视频能转码，手机也能用。
          <br />
          <span className="font-medium text-ink">编辑</span>：改上传者 / 点赞数 / 标题 / 标签 /
          可见性，导出 JSON 覆盖仓库文件。
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.filter(([key]) => key === 'upload' || access.canEdit).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={[
              '-mb-px border-b-2 px-4 py-2 text-[13px] font-medium transition',
              effectiveTab === key
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-3 hover:text-ink-2',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-ink-3">
          {access.canEdit
            ? '站长身份：可上传，也可编辑已入库内容'
            : access.canUpload
              ? '贡献者身份：只能上传，编辑只归站长'
              : '访客身份'}
        </span>
      </div>

      {effectiveTab === 'upload' && <UploadPanel />}

      {effectiveTab === 'edit' && (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ---------------- 编辑区 ---------------- */}
        <div className="min-w-0 space-y-4">
          {loading && <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />}

          {!loading && error && (
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
              <p className="text-sm font-medium text-ink">数据加载失败</p>
              <p className="mt-1 font-mono text-xs break-all text-ink-3">{error}</p>
            </div>
          )}

          {!loading &&
            !error &&
            files.map((file) => (
              <section
                key={file.month}
                className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm"
              >
                <header className="flex items-center gap-2.5 border-b border-line bg-surface-2/60 px-4 py-3">
                  <span className="h-4 w-1 rounded-full bg-accent" />
                  <h2 className="text-[14px] font-semibold text-ink">
                    {formatMonthLabel(file.month)}
                  </h2>
                  <span className="font-mono text-[11px] text-ink-3">{file.entries.length} 条</span>
                </header>

                <div>
                  {file.entries.map((entry) => {
                    const draft = drafts[entry.id] ?? {};
                    return (
                      <div
                        key={entry.id}
                        className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0"
                      >
                        <img
                          src={mediaUrl(entry.thumb)}
                          alt=""
                          loading="lazy"
                          className="size-14 shrink-0 rounded-xl object-cover ring-1 ring-black/5"
                        />

                        <div className="grid min-w-[260px] flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          <Field label="上传者（GitHub 登录名）">
                            <div className="flex items-center gap-1.5">
                              <Avatar contributor={entry.contributor} size={18} />
                              <input
                                value={draft.login ?? entry.contributor.login}
                                onChange={(event) => update(entry.id, { login: event.target.value })}
                                className={INPUT}
                              />
                            </div>
                          </Field>

                          <Field label="点赞数">
                            <input
                              type="number"
                              min={0}
                              value={draft.likes ?? entry.likes}
                              onChange={(event) =>
                                update(entry.id, { likes: Number(event.target.value) })
                              }
                              className={`${INPUT} font-mono`}
                            />
                          </Field>

                          <Field label="标题">
                            <input
                              value={draft.title ?? entry.title ?? ''}
                              placeholder="（无）"
                              onChange={(event) => update(entry.id, { title: event.target.value })}
                              className={INPUT}
                            />
                          </Field>

                          <Field label="标签（逗号分隔）">
                            <input
                              value={draft.tags ?? (entry.tags ?? []).join(',')}
                              placeholder="抽象,搞笑"
                              onChange={(event) => update(entry.id, { tags: event.target.value })}
                              className={INPUT}
                            />
                          </Field>
                        </div>

                        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
                          <input
                            type="checkbox"
                            checked={draft.visible ?? entry.visible !== false}
                            onChange={(event) =>
                              update(entry.id, { visible: event.target.checked })
                            }
                            className="size-4 accent-accent"
                          />
                          可见
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
        </div>

        {/* ---------------- 导出区 ---------------- */}
        <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
          {/* ---------------- 一键提交 ---------------- */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[14px] font-semibold text-ink">提交修改</h2>
              <span className="font-mono text-[11px] text-ink-3">
                {changedCount > 0 ? `${changedCount} 条改动` : '暂无改动'}
              </span>
            </div>

            <p className="mt-2 text-[12px] leading-5 text-ink-2">
              {access.canEdit
                ? '只把改动的月份 JSON 推到 edit 分支，Actions 会合进 main、重建 manifest 与榜单，再自动重新部署。'
                : '只有站长能提交修改。'}
            </p>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void submitEdits()}
              className="mt-3 w-full rounded-xl bg-accent px-3 py-2 text-[13px] font-medium text-white shadow-sm shadow-accent/30 transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-40"
            >
              {editPhase === 'submitting' ? '提交中…' : `提交 ${changedCount} 条改动`}
            </button>

            {editMessage && (
              <p
                className={[
                  'mt-2 text-[11px] leading-4 break-all',
                  editPhase === 'failed' ? 'text-like' : 'text-ink-2',
                ].join(' ')}
              >
                {editMessage}
              </p>
            )}
            {editRun?.htmlUrl && (
              <a
                href={editRun.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-block text-[11px] font-medium text-accent hover:underline"
              >
                查看重建进度 ↗
              </a>
            )}
            {!access.token && access.canEdit === false && (
              <p className="mt-2 text-[11px] text-ink-3">先在「上传」页签填好访问令牌。</p>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[14px] font-semibold text-ink">手动导出（备用）</h2>
              <span className="font-mono text-[11px] text-ink-3">
                {changedCount > 0 ? `${changedCount} 条改动` : '暂无改动'}
              </span>
            </div>

            {changedOutputs.length === 0 ? (
              <p className="mt-3 text-[12px] text-ink-3">
                改点东西（比如把某条的点赞数调高），这里就会出现可导出的文件。
              </p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {changedOutputs.map((output) => (
                    <button
                      key={output.name}
                      type="button"
                      onClick={() => setSelectedName(output.name)}
                      className={[
                        'rounded-lg border px-2.5 py-1 font-mono text-[11px] transition',
                        selected?.name === output.name
                          ? 'border-accent bg-accent-soft text-accent-ink'
                          : 'border-line text-ink-2 hover:border-accent/40 hover:text-accent',
                      ].join(' ')}
                    >
                      {output.name}
                    </button>
                  ))}
                </div>

                {selected && (
                  <>
                    <p className="mt-3 font-mono text-[10px] break-all text-ink-3">
                      {selected.path}
                    </p>
                    <textarea
                      readOnly
                      value={selectedText}
                      spellCheck={false}
                      className="mt-1.5 h-56 w-full resize-y rounded-xl border border-line bg-surface-2 p-2.5 font-mono text-[11px] leading-4 text-ink-2 outline-none"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(selectedText).then(() => {
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 1500);
                          });
                        }}
                        className="flex-1 rounded-xl border border-line px-3 py-2 text-[12px] font-medium text-ink-2 transition hover:border-accent/40 hover:text-accent"
                      >
                        {copied ? '已复制 ✓' : '复制'}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadJson(selected.name, selectedText)}
                        className="flex-1 rounded-xl bg-accent px-3 py-2 text-[12px] font-medium text-white shadow-sm shadow-accent/30 transition hover:bg-accent-bright"
                      >
                        下载
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        changedOutputs.forEach((output, index) =>
                          window.setTimeout(
                            () => downloadJson(output.name, `${JSON.stringify(output.json, null, 2)}\n`),
                            index * 250,
                          ),
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-line px-3 py-2 text-[12px] font-medium text-ink-2 transition hover:border-accent/40 hover:text-accent"
                    >
                      下载全部 {changedOutputs.length} 个文件
                    </button>
                  </>
                )}
              </>
            )}

            {changedCount > 0 && (
              <button
                type="button"
                onClick={() => setDrafts({})}
                className="mt-2 w-full rounded-xl px-3 py-1.5 text-[11px] text-ink-3 transition hover:text-like"
              >
                放弃全部改动
              </button>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <h2 className="text-[14px] font-semibold text-ink">提交后会发生什么</h2>
            <ol className="mt-2.5 space-y-2 text-[12px] leading-5 text-ink-2">
              <li>
                <span className="font-mono text-accent">1.</span> 浏览器把改动的月份 JSON 推到{' '}
                <code className="font-mono text-ink">edit/&lt;批次&gt;</code> 分支
              </li>
              <li>
                <span className="font-mono text-accent">2.</span> Actions 把它合进 main，并跑{' '}
                <code className="font-mono text-ink">build-index.mjs</code> 重建 manifest.json 与
                rankings.json
              </li>
              <li>
                <span className="font-mono text-accent">3.</span> 临时分支被删除，站点自动重新部署
                （约 1–2 分钟）
              </li>
            </ol>
            <p className="mt-2 text-[11px] leading-4 text-ink-3">
              派生文件故意不在浏览器里算：榜单逻辑只有一份实现（scripts/build-index.mjs），
              复制到前端迟早会漂移。上面「手动导出」留给你离线或备份用。
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <h2 className="text-[14px] font-semibold text-ink">几点说明</h2>
            <ul className="mt-2.5 space-y-2 text-[12px] leading-5 text-ink-2">
              <li>
                这里的<b>点赞数</b>是站长维护的基准值。访客自己点的那一下只记在他本机，
                所以同一条内容不同人看到的数字可能差 1。
              </li>
              <li>
                <b>上传者</b>填 GitHub 登录名。头像优先用数据里的{' '}
                <code className="font-mono text-ink">contributor.avatar</code>（S4 的脚本会按登录名自动填），
                没有就退化成首字母色块，不会出现破图。
              </li>
              <li>
                取消勾选<b>可见</b>即可软下架：条目仍留在仓库里，但不会出现在站点和榜单上。
              </li>
            </ul>
          </div>
        </aside>
      </div>
      )}
    </div>
  );
}

const INPUT =
  'w-full min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block truncate text-[10px] text-ink-3">{label}</span>
      {children}
    </label>
  );
}
