import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AccessProvider } from './lib/access';
import { LikeProvider } from './lib/likes';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

// 部署在 GitHub Pages 项目站点时站点根是 /<repo>/，路由必须带上同样的 basename，
// 否则 <Link> 会跳到域名根、深链也会散架。
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

createRoot(container).render(
  <StrictMode>
    <AccessProvider>
      <LikeProvider>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </LikeProvider>
    </AccessProvider>
  </StrictMode>,
);
