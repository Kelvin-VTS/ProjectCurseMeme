import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { MonthPage } from './pages/MonthPage';
import { Admin } from './pages/Admin';
import { Guide } from './pages/Guide';
import { Login } from './pages/Login';
import { Search } from './pages/Search';

function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="font-mono text-5xl text-line-strong">404</p>
      <p className="mt-3 text-ink-2">这里什么都没有。</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link
          to="/"
          className="rounded-xl border border-line px-4 py-2 text-sm text-ink-2 transition hover:border-accent/50 hover:text-accent"
        >
          回到首页
        </Link>
        <Link
          to="/guide"
          className="rounded-xl border border-line px-4 py-2 text-sm text-ink-2 transition hover:border-accent/50 hover:text-accent"
        >
          投稿指引
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="month/:month" element={<MonthPage />} />
        <Route path="search" element={<Search />} />
        <Route path="guide" element={<Guide />} />
        <Route path="login" element={<Login />} />
        <Route path="admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
