import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import logoUrl from '../assets/logo.webp';
import { useAccess } from '../lib/access';
import { SITE } from '../lib/site';

const REPO_URL = `https://github.com/${SITE.repo.owner}/${SITE.repo.name}`;
const SUBMIT_URL = `${REPO_URL}/issues/new?template=submit.md`;
const PAT_URL = 'https://github.com/settings/personal-access-tokens/new';

/**
 * 登录页。
 *
 * 单独一页、和「投稿 / 上传」分开，是因为这里做的事只有一件：**把这台设备
 * 绑定到一个 GitHub 令牌上**。它属于账号层面，而不是某一次投稿的流程 ——
 * 混在上传面板里，访客会以为"想投稿就得先搞懂令牌"。
 *
 * 所以这一页同时承担三件事：
 *   1. 正常的登录表单（粘贴令牌 → 校验 → 显示身份）
 *   2. 明确告诉访客：**你多半不需要令牌**，投稿表单不用登录
 *   3. 把令牌的真实风险说清楚（等于仓库写权限）
 */
export function Login() {
  const access = useAccess();
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    const ok = await access.connect(draft);
    if (ok) {
      setDraft('');
      setReveal(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center pt-2 sm:pt-10">
      <img
        src={logoUrl}
        alt=""
        width={56}
        height={56}
        className="size-14 rounded-2xl shadow-lg shadow-accent/30 ring-1 ring-black/10"
      />
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{SITE.name}</h1>
      <p className="mt-1 text-[12px] text-ink-3">
        {access.login ? '这台设备已绑定账号' : '用 GitHub 令牌登录，就能往这里投素材'}
      </p>

      {/* ---------------- 主卡片 ---------------- */}
      <div className="mt-6 w-full rounded-2xl border border-line bg-surface p-5 shadow-sm">
        {access.login ? (
          <div className="text-center">
            {access.avatarUrl ? (
              <img
                src={access.avatarUrl}
                alt=""
                className="mx-auto size-14 rounded-full ring-2 ring-accent/30"
              />
            ) : (
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft text-lg font-semibold text-accent-ink">
                {access.login.slice(0, 1).toUpperCase()}
              </div>
            )}

            <p className="mt-3 text-[15px] font-semibold text-ink">{access.login}</p>
            <p className="mt-1.5">
              <span
                className={[
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  access.canEdit
                    ? 'bg-accent-soft text-accent-ink'
                    : 'bg-accent-2-soft text-accent-2',
                ].join(' ')}
              >
                {access.canEdit ? '站长' : '贡献者'}
              </span>
            </p>

            <p className="mt-3 text-[12px] leading-5 text-ink-2">
              {access.canEdit
                ? '你可以上传素材，也可以修改已入库内容（点赞 / 上传者 / 下架）。'
                : '你可以上传素材；修改已入库内容只有站长能做。'}
            </p>

            <div className="mt-4 space-y-2">
              <Link
                to="/admin"
                className="block rounded-xl bg-accent py-2.5 text-[13px] font-medium text-white shadow-sm shadow-accent/30 transition hover:bg-accent-bright"
              >
                进入{access.canEdit ? '上传 / 管理' : '上传'}
              </Link>
              <button
                type="button"
                onClick={access.disconnect}
                className="w-full rounded-xl border border-line py-2 text-[12px] font-medium text-ink-2 transition hover:border-like/40 hover:text-like"
              >
                退出登录
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="pat" className="mb-1.5 block text-[11px] font-medium text-ink-2">
                访问令牌（fine-grained PAT）
              </label>
              <div className="relative">
                <input
                  id="pat"
                  type={reveal ? 'text' : 'password'}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="github_pat_11ABC…"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 pr-14 font-mono text-[12px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
                <button
                  type="button"
                  onClick={() => setReveal((value) => !value)}
                  className="absolute inset-y-0 right-1.5 my-auto h-6 rounded-lg px-2 text-[11px] text-ink-3 transition hover:text-ink"
                >
                  {reveal ? '隐藏' : '显示'}
                </button>
              </div>
            </div>

            {access.error && (
              <div className="rounded-xl border border-like/30 bg-like-soft px-3 py-2 text-[11px] leading-4 break-all text-like">
                {access.error}
              </div>
            )}

            <button
              type="submit"
              disabled={!draft.trim() || access.checking}
              className="w-full rounded-xl bg-accent py-2.5 text-[13px] font-medium text-white shadow-sm shadow-accent/30 transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-40"
            >
              {access.checking ? '校验中…' : '登录'}
            </button>

            <div className="flex items-center gap-2 pt-1">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[10px] text-ink-3">或者</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <a
              href={SUBMIT_URL}
              target="_blank"
              rel="noreferrer"
              className="block w-full rounded-xl border border-line py-2.5 text-center text-[12px] font-medium text-ink-2 transition hover:border-accent/40 hover:text-accent"
            >
              我没有令牌 —— 用投稿表单（不需要登录）
            </a>

            <p className="text-center text-[11px] text-ink-3">
              只是路过？<Link to="/" className="text-accent hover:underline">先随便逛逛</Link>
            </p>
          </form>
        )}
      </div>

      {/* ---------------- 登录后能做什么 ---------------- */}
      <div className="mt-4 w-full rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <h2 className="text-[13px] font-semibold text-ink">登录后能做什么</h2>
        <table className="mt-2 w-full text-[12px]">
          <thead>
            <tr className="text-[10px] text-ink-3">
              <th className="pb-1 text-left font-normal">能力</th>
              <th className="w-16 pb-1 text-center font-normal">访客</th>
              <th className="w-16 pb-1 text-center font-normal">登录后</th>
            </tr>
          </thead>
          <tbody className="text-ink-2">
            <tr>
              <td className="py-1">浏览全部内容</td>
              <td className="text-center text-accent">✓</td>
              <td className="text-center text-accent">✓</td>
            </tr>
            <tr>
              <td className="py-1">上传素材</td>
              <td className="text-center text-ink-3">✗</td>
              <td className="text-center text-accent">✓</td>
            </tr>
            <tr>
              <td className="py-1">编辑已入库内容</td>
              <td className="text-center text-ink-3">✗</td>
              <td className="text-center text-ink-3">仅站长</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[11px] leading-4 text-ink-3">
          注意：这是<b>界面层</b>的角色区分，不是安全边界。真正的边界是令牌本身。
        </p>
      </div>

      {/* ---------------- 令牌说明 ---------------- */}
      <details className="mt-4 w-full rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <summary className="cursor-pointer text-[13px] font-semibold text-ink select-none">
          令牌从哪来？怎么保证安全？
        </summary>
        <ol className="mt-2.5 space-y-1.5 text-[12px] leading-5 text-ink-2">
          <li>
            <span className="font-mono text-accent">1.</span> 打开{' '}
            <a
              href={PAT_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent hover:underline"
            >
              GitHub → 新建 fine-grained token
            </a>
          </li>
          <li>
            <span className="font-mono text-accent">2.</span> Repository access 只选{' '}
            <code className="font-mono text-ink">
              {SITE.repo.owner}/{SITE.repo.name}
            </code>
          </li>
          <li>
            <span className="font-mono text-accent">3.</span> Permissions 里只勾{' '}
            <b>Contents: Read and write</b>，其它一个都不用开
          </li>
          <li>
            <span className="font-mono text-accent">4.</span> 生成后立刻复制（只显示一次），粘贴到上面
          </li>
        </ol>

        <p className="mt-2.5 rounded-xl bg-like-soft px-3 py-2 text-[11px] leading-4 text-like">
          ⚠️ 这个令牌等于仓库的写权限：能改前端代码、能删文件、能把站点换成别的东西。
          只在自己的设备上填，别外传、别截图发群、别放进代码仓库。
        </p>
        <p className="mt-2 text-[11px] leading-4 text-ink-3">
          令牌只存在这个浏览器的 localStorage，不会上传到任何服务器；换设备或换浏览器需要重新登录。
          平时不投稿的话，随时点「退出登录」清掉它。
        </p>
        <p className="mt-2 text-[11px] leading-4 text-ink-3">
          普通访客不需要令牌 —— 走{' '}
          <Link to="/guide" className="font-medium text-accent hover:underline">
            投稿指引
          </Link>{' '}
          里的表单就行，用你自己的 GitHub 账号，提交后会由站长审核。
        </p>
      </details>
    </div>
  );
}
