import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages 项目站点部署在 /<repo>/ 下，用 VITE_BASE 注入；
// 本地开发保持 '/'。
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
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
