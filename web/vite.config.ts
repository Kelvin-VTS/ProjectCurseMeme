import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// GitHub Pages 项目站点部署在 /<repo>/ 下，由 CI 注入 VITE_BASE；本地开发保持 '/'。
const base = process.env.VITE_BASE ?? '/';

/**
 * GitHub Pages 不认 SPA 路由：直接访问 /<repo>/month/2026-10 会命中 404。
 * 标准做法是把 index.html 复制一份成 404.html，让 Pages 用首页接管未知路径，
 * 再由前端路由解析真实地址。
 */
function spaFallback(): Plugin {
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    async closeBundle() {
      const outDir = path.resolve(rootDir, 'dist');
      await copyFile(path.join(outDir, 'index.html'), path.join(outDir, '404.html'));
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), spaFallback()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    watch: {
      // Windows 上编辑器/工具常用「原子替换」写文件（先写临时文件再改名），
      // 这会让 Vite 默认的 fs.watch 抛 EBUSY 直接把 dev server 干掉。
      // 改用轮询即可彻底避开，代价是极小的 CPU 占用。
      usePolling: true,
      interval: 300,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
