import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { MonthPage } from './pages/MonthPage';
import { Admin } from './pages/Admin';

function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="font-mono text-5xl text-ink-600">404</p>
      <p className="mt-3 text-mist-300">这里什么都没有。</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-lg border border-ink-700 px-4 py-2 text-sm text-mist-300 transition hover:border-neon-violet/60 hover:text-mist-100"
      >
        回到首页
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="month/:month" element={<MonthPage />} />
        <Route path="admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
