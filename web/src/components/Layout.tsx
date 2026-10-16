import { NavLink, Outlet } from 'react-router-dom';
import logoUrl from '../assets/logo.webp';
import { SITE } from '../lib/site';
import { useAccess } from '../lib/access';

export function Layout() {
  const access = useAccess();

  // 导航按角色变化：访客只能看到投稿指引，站长/贡献者才有上传入口
  const nav = [
    { to: '/', label: '首页', end: true },
    { to: '/guide', label: '投稿指引', end: false },
    ...(access.canUpload
      ? [{ to: '/admin', label: access.canEdit ? '上传 / 管理' : '上传', end: false }]
      : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <NavLink to="/" className="flex min-w-0 items-center gap-2.5">
            <img
              src={logoUrl}
              alt=""
              width={32}
              height={32}
              className="size-8 shrink-0 rounded-xl shadow-sm shadow-accent/40 ring-1 ring-black/10"
            />
            <span className="min-w-0">
              <span className="block truncate text-[15px] leading-tight font-semibold tracking-tight text-ink">
                {SITE.name}
              </span>
              <span className="hidden truncate text-[11px] leading-tight text-ink-3 md:block">
                {SITE.tagline}
              </span>
            </span>
          </NavLink>

          <nav className="ml-auto flex items-center gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'rounded-xl px-3 py-1.5 text-[13px] font-medium transition',
                    isActive
                      ? 'bg-accent text-white shadow-sm shadow-accent/30'
                      : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}

            {access.login ? (
              <NavLink
                to="/admin"
                title={`${access.canEdit ? '站长' : '贡献者'} · ${access.login}`}
                className="ml-1 flex items-center gap-1.5 rounded-xl border border-line px-2 py-1 transition hover:border-accent/40"
              >
                {access.avatarUrl && (
                  <img src={access.avatarUrl} alt="" className="size-5 rounded-full ring-1 ring-black/10" />
                )}
                <span className="max-w-[90px] truncate text-[11px] text-ink-2">{access.login}</span>
                <span
                  className={[
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                    access.canEdit ? 'bg-accent-soft text-accent-ink' : 'bg-accent-2-soft text-accent-2',
                  ].join(' ')}
                >
                  {access.canEdit ? '站长' : '贡献者'}
                </span>
              </NavLink>
            ) : (
              <span
                aria-disabled="true"
                title="搜索与筛选将在后续版本实现"
                className="cursor-not-allowed rounded-xl px-3 py-1.5 text-[13px] text-ink-3/60"
              >
                搜索
              </span>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-6 pb-24 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-line py-6 text-center text-[11px] text-ink-3">
        个人归档站点 · 内容由投稿人提供 ·{' '}
        <NavLink to="/guide" className="transition hover:text-accent">
          投稿指引
        </NavLink>
      </footer>
    </div>
  );
}
