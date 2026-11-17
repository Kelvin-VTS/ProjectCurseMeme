import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SITE } from '../lib/site';
import { useAccess } from '../lib/access';
import { makeBatchId, today } from '../lib/batch';
import { renderMarkdown } from '../lib/markdown';
import { fetchIngestRun, submitTextPost, type BatchResult, type IngestRun } from '../lib/github';

const FIELD =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

const PREVIEW_CLASS = [
  'min-h-[300px] text-[13px] leading-6 text-ink-2',
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
 * 纯文字记录编辑器。
 *
 * 和上传面板并列为「上传」页签下的两种模式。文字条目没有媒体文件，
 * 所以走 submitTextPost → job.json 里的 posts → ingest 侧 add-posts 入库，
 * 前端的预览用的是**和详情弹窗同一个渲染器**，所见即所得。
 */
export function TextComposer() {
  const { owner, name: repo } = SITE.repo;
  const access = useAccess();

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today);
  const [group, setGroup] = useState('');
  const [tags, setTags] = useState('');
  const [login, setLogin] = useState('');

  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [run, setRun] = useState<IngestRun | null>(null);
  const [checking, setChecking] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const signature = login.trim() || access.login || '';
  const tagList = useMemo(
    () => tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
    [tags],
  );
  const preview = useMemo(() => renderMarkdown(note), [note]);

  const ready = access.canUpload && note.trim().length > 0 && !sending;

  /** 把选中内容用成对标记包起来（粗体/斜体/代码） */
  function wrap(before: string, after = before, placeholder = '文字') {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = note.slice(start, end) || placeholder;
    setNote(`${note.slice(0, start)}${before}${selected}${after}${note.slice(end)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  /** 在光标所在行前面加前缀（标题/列表/引用） */
  function prefixLine(prefix: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = note.lastIndexOf('\n', start - 1) + 1;
    setNote(`${note.slice(0, lineStart)}${prefix}${note.slice(lineStart)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  }

  async function refreshRun() {
    if (!result) return;
    setChecking(true);
    try {
      setRun(await fetchIngestRun(owner, repo, result.branch));
    } catch {
      /* 状态查询受限不影响提交本身 */
    } finally {
      setChecking(false);
    }
  }

  async function submit() {
    if (!ready) return;
    setSending(true);
    setError(null);
    setResult(null);
    setRun(null);
    try {
      const outcome = await submitTextPost({
        token: access.token,
        owner,
        repo,
        post: {
          batch: makeBatchId(),
          login: signature || 'unknown',
          note: note.trim(),
          title: title.trim() || undefined,
          date,
          group: group.trim() || undefined,
          tags: tagList,
        },
      });
      setResult(outcome);
      setNote('');
      setTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        {/* ---------------- 编辑器 ---------------- */}
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <div className="flex rounded-lg border border-line p-0.5">
              {(
                [
                  ['edit', '编辑'],
                  ['preview', '预览'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMode(key)}
                  className={[
                    'rounded-md px-3 py-1 text-[12px] font-medium transition',
                    mode === key ? 'bg-accent text-white' : 'text-ink-3 hover:text-ink',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === 'edit' && (
              <div className="flex flex-wrap items-center gap-1">
                {[
                  { label: 'B', title: '粗体', run: () => wrap('**', '**', '粗体') },
                  { label: 'I', title: '斜体', run: () => wrap('*', '*', '斜体') },
                  { label: 'H', title: '标题', run: () => prefixLine('## ') },
                  { label: '•', title: '列表', run: () => prefixLine('- ') },
                  { label: '❝', title: '引用', run: () => prefixLine('> ') },
                  { label: '🔗', title: '链接', run: () => wrap('[', '](https://)', '链接文字') },
                  { label: '</>', title: '行内代码', run: () => wrap('`', '`', '代码') },
                ].map((tool) => (
                  <button
                    key={tool.title}
                    type="button"
                    title={tool.title}
                    onClick={tool.run}
                    className="grid h-7 min-w-7 place-items-center rounded-md border border-line px-1.5 text-[11px] font-medium text-ink-2 transition hover:border-accent/50 hover:text-accent"
                  >
                    {tool.label}
                  </button>
                ))}
              </div>
            )}

            <span className="ml-auto font-mono text-[11px] text-ink-3">{note.length} 字</span>
          </div>

          <div className="p-3">
            {mode === 'edit' ? (
              <textarea
                ref={bodyRef}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={16}
                placeholder={'写点什么…\n\n支持 Markdown：\n# 标题\n**粗体** *斜体* `代码`\n- 列表项\n> 引用\n[链接](https://example.com)'}
                className={`${FIELD} resize-y font-mono text-[12.5px] leading-6`}
              />
            ) : (
              <div className={PREVIEW_CLASS}>
                {preview ? (
                  // 渲染器先把文本转义、再只生成白名单标签
                  <div dangerouslySetInnerHTML={{ __html: preview }} />
                ) : (
                  <p className="text-ink-3">左边还没写内容。</p>
                )}
              </div>
            )}
          </div>
        </div>

        {result && (
          <div className="rounded-2xl border border-accent-2/30 bg-accent-2-soft p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-semibold text-accent-2">已提交，等待 Actions 处理</p>
              <button
                type="button"
                onClick={() => void refreshRun()}
                disabled={checking}
                className="rounded-lg border border-current/30 px-2 py-0.5 text-[11px] font-medium text-ink-2 transition hover:bg-surface disabled:opacity-50"
              >
                {checking ? '查询中…' : '刷新结果'}
              </button>
            </div>
            <p className="mt-1 text-[12px] leading-5 text-ink-2">
              {run
                ? run.phase === 'completed'
                  ? run.conclusion === 'success'
                    ? '处理完成，站点正在重新部署，约 1 分钟后首页就能看到。'
                    : '处理失败，点「运行日志」看原因。'
                  : 'Actions 正在处理…'
                : '已推到临时分支，通常 1–2 分钟完成；也可以直接打开运行日志。'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
              <a
                href={run?.htmlUrl || `https://github.com/${owner}/${repo}/actions`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-line px-2.5 py-1 font-medium text-ink-2 transition hover:text-ink"
              >
                运行日志
              </a>
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
            <p className="text-[13px] font-semibold text-like">提交失败</p>
            <p className="mt-1 font-mono text-[11px] break-all text-ink-2">{error}</p>
            <p className="mt-2 text-[11px] text-ink-2">
              常见原因：令牌过期或没有 Contents: Read and write 权限、网络中断。
            </p>
          </div>
        )}
      </div>

      {/* ---------------- 右侧：元数据 ---------------- */}
      <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-[14px] font-semibold text-ink">这条记录的属性</h2>
          <div className="mt-2.5 space-y-2.5">
            <Labeled label="标题（可留空）">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="给这段文字起个名字"
                className={FIELD}
              />
            </Labeled>
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
                placeholder="抽象,日常"
                className={FIELD}
              />
            </Labeled>
            <Labeled label="上传者署名">
              <input
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                placeholder={access.login ?? 'GitHub 登录名'}
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
            {sending ? '提交中…' : '发布文字记录'}
          </button>

          {!access.canUpload && (
            <p className="mt-2 text-[11px] leading-4 text-ink-3">
              发布需要先{' '}
              <Link to="/login" className="font-medium text-accent hover:underline">
                登录
              </Link>
              。只想投稿的话可以用投稿表单，不需要登录。
            </p>
          )}
          {access.canUpload && !note.trim() && (
            <p className="mt-2 text-[11px] text-ink-3">正文不能为空。</p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-[14px] font-semibold text-ink">文字记录是什么</h2>
          <ul className="mt-2.5 space-y-2 text-[12px] leading-5 text-ink-2">
            <li>不需要图片或视频，一段文字就能单独成条。</li>
            <li>正文是 Markdown；卡片上显示摘要，点开看全文。</li>
            <li>和媒体条目一起按日期归月，占同一个点赞与浏览位置。</li>
            <li>入库仍然走 Actions，所以提交后约 1–2 分钟才出现在站点上。</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] text-ink-3">{label}</span>
      {children}
    </label>
  );
}
