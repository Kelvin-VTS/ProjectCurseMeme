import { createReadStream, statSync } from 'node:fs';
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

const MIME_BY_EXT: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
};

/**
 * 开发期把 /media 指向**仓库根**的 media/ 目录。
 *
 * 为什么要这样：媒体一旦放进 web/public，就会被打进 Pages 产物，
 * 几百 MB 素材直接顶到「已发布站点 ≤1GB」的天花板。
 * 所以产物里只有 HTML/CSS/JS/JSON，媒体在开发期由这个中间件服务，
 * 线上则由 VITE_MEDIA_BASE 指向 raw.githubusercontent.com。
 *
 * 找不到的文件交给 next()，Vite 会继续去 web/public 里找。
 */
function serveRepoMedia(): Plugin {
  const mediaRoot = path.resolve(rootDir, '..', 'media');

  return {
    name: 'serve-repo-media',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/media', (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        const filePath = path.join(mediaRoot, urlPath);

        // 防目录穿越
        if (!filePath.startsWith(mediaRoot + path.sep)) return next();

        let size: number;
        try {
          const stats = statSync(filePath);
          if (!stats.isFile()) return next();
          size = stats.size;
        } catch {
          return next();
        }

        res.setHeader(
          'Content-Type',
          MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        );
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache');

        if (req.method === 'HEAD') {
          res.setHeader('Content-Length', String(size));
          res.statusCode = 200;
          res.end();
          return;
        }

        // 视频拖动进度条要用 Range，浏览器会先发一个 bytes=0- 的探测请求
        const range = req.headers.range;
        const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
        if (match) {
          const start = match[1] ? Number(match[1]) : 0;
          const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
          if (start <= end && start < size) {
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
            res.setHeader('Content-Length', String(end - start + 1));
            createReadStream(filePath, { start, end }).pipe(res);
            return;
          }
        }

        res.statusCode = 200;
        res.setHeader('Content-Length', String(size));
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), spaFallback(), serveRepoMedia()],
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
