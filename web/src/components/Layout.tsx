import { NavLink, Outlet } from 'react-router-dom';
import { SITE } from '../lib/site';

const NAV = [
  { to: '/', label: '首页', end: true },
  { to: '/admin', label: '上传 / 管理', end: false },
];

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <NavLink to="/" className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-bright text-[14px] font-bold text-white shadow-sm shadow-accent/40">
              阴
            </span>
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
            {NAV.map((item) => (
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
            <span
              aria-disabled="true"
              title="搜索与筛选将在后续版本实现"
              className="cursor-not-allowed rounded-xl px-3 py-1.5 text-[13px] text-ink-3/60"
            >
              搜索
            </span>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-6 pb-24 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-line py-6 text-center text-[11px] text-ink-3">
        个人归档站点 · 内容由投稿人提供
      </footer>
    </div>
  );
}
