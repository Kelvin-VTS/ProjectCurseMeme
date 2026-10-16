# 阴间素材库

微信群抽象图片 / 视频的个人归档站。按月份分类展示，支持多人投稿。

当前进度：**S1 骨架 + S2 假数据主页 + 第一轮 UI 改版 + 线上部署**。

线上地址：**https://kelvin-vts.github.io/ProjectCurseMeme/**

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite 7 + React 19 + TypeScript |
| 样式 | Tailwind CSS v4（`@theme` 语义化 token，浅色主题） |
| 路由 | React Router v7（SPA） |
| 数据 | 静态 JSON（`manifest.json` + `months/yyyy-mm.json` + `rankings.json`） |
| 托管 | GitHub Pages（前端）+ 仓库内 `media/`（媒体） |
| 投稿 | GitHub Issue 表单 → Actions 处理 → 草稿 PR → 人工 Merge |

## 目录结构

```
ProjectCurseMeme/
├─ web/                         前端
│  ├─ src/
│  │  ├─ components/            布局、瀑布流、卡片、点赞、榜单、预览层
│  │  ├─ lib/
│  │  │  ├─ data.ts             地址解析、manifest / 月份 / 榜单读取
│  │  │  ├─ likes.tsx           访客本地点亮状态（可整体替换成共享计数）
│  │  │  ├─ date.ts             纯字符串日期工具，零 new Date()
│  │  │  └─ site.ts             站点文案
│  │  ├─ pages/                 Home / MonthPage / Admin
│  │  └─ types.ts               Entry / Manifest / Rankings 数据契约
│  └─ public/
│     ├─ data/                  索引与榜单（提交进仓库）
│     └─ media/placeholder/     S2 占位图（后续被真实素材替换）
├─ media/                       真实媒体文件（待创建，提交进仓库）
└─ scripts/
   ├─ seed-fake-data.py         生成 S2 假数据（开发期脚手架）
   └─ build-index.mjs           派生 manifest.json 与 rankings.json
```

## 数据管线

**唯一数据源是月份 JSON**。`manifest.json` 和 `rankings.json` 都是派生文件，
由同一个脚本生成，不允许手写：

```
站长编辑台（/admin 页面）─┐
seed 脚本                ─┼─→ web/public/data/months/*.json
S4 Actions 投稿流程       ─┘              │
                                          ▼
                            node scripts/build-index.mjs
                                          │
                      ┌───────────────────┴───────────────────┐
                      ▼                                       ▼
              manifest.json                            rankings.json
       （总数 / 总点赞 / 月份索引）            （本月榜 / 年度榜，按点赞数）
```

这样做的好处：榜单计算只有一份实现，站长手工编辑和 Actions 自动入库走的是同一条路，
不会出现「页面算的榜单和脚本算的不一致」。

## 开发

> 本机 PowerShell 执行策略是默认的 Restricted，`npm.ps1` 会被拦住。
> **一律用 `npm.cmd`**，或者自己执行一次
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

```powershell
cd web
npm.cmd install
npm.cmd run dev        # http://127.0.0.1:5173
npm.cmd run build      # 类型检查 + 构建
```

重新生成假数据（会覆盖月份 JSON）：

```powershell
python scripts/seed-fake-data.py
node scripts/build-index.mjs
```

改完点赞数 / 上传者 / 可见性后，重建索引：

```powershell
node scripts/build-index.mjs
```

## 点赞模型（必读）

这是个纯静态站，没有数据库，所以点赞分两层：

| | 存在哪 | 谁维护 |
|---|---|---|
| **基准计数** | 仓库 JSON 的 `likes` 字段 | 站长（`/admin` 编辑台） |
| **本机点亮** | 访客浏览器的 localStorage | 访客自己 |
| **显示数字** | 上面两者相加 | — |

因此：**不同人看到的同一条内容可能差 1**，排行榜按基准计数排序。
访客是无法刷高全局数字的，站长也不会被恶意点击影响。

想升级成真正的全网共享计数，只需替换 `web/src/lib/likes.tsx` 这一层
（后端 KV，或走 GitHub Issue 的 👍 reactions），组件代码一行都不用改。

## 关键设计决定

1. **媒体不进构建产物**。`media/` 放在 `web/public` **之外**，站点通过
   `VITE_MEDIA_BASE`（指向 `raw.githubusercontent.com`）引用，因此 Pages 产物永远只有几百 KB。
2. **每条 Entry 必存 `width`/`height`**。瀑布流靠它做 `aspect-ratio` 占位，
   图片没加载出来时高度就是对的，滚动不抖动。
3. **日期全程走字符串**。`lib/date.ts` 里没有任何 `new Date()`，
   彻底避开 `new Date('2026-10-05')` 被当成 UTC 导致显示成 10 月 4 日的经典 bug。
4. **视频卡片不渲染 `<video>`**。网格里只有首帧海报 + 播放角标，
   点开预览层才挂载 video 元素，否则一屏二十个视频会拖垮手机。
5. **瀑布流自己分列**，不用 CSS `columns`。后者是列优先排版，会打乱时间倒序。
6. **卡片外层不是 `<button>`**。点赞是卡片内的独立按钮，HTML 不允许按钮嵌套。
   卡片结构变化时要同步改 `MasonryGrid` 里的 `estimateMetaHeight`，否则列高会算歪。
7. **`visible: false` 是软下架**。条目留在仓库里、可从 git 历史恢复，
   但不会出现在站点、`manifest` 和榜单里。
8. **dev server 用轮询监听**。Windows 上编辑器做原子替换会让 Vite 的 `fs.watch`
   抛 `EBUSY` 直接崩掉，`vite.config.ts` 里已改成 `usePolling`。

## 环境变量（部署时用）

| 变量 | 作用 |
|---|---|
| `VITE_BASE` | Pages 项目站点的子路径，如 `/ProjectCurseMeme/` |
| `VITE_DATA_BASE` | 数据根路径，默认 `/data` |
| `VITE_MEDIA_BASE` | 媒体根，如 `https://raw.githubusercontent.com/<user>/<repo>/main` |
| `VITE_DATA_VERSION` | 提交 SHA，绕开 raw 的约 5 分钟 CDN 缓存 |

## 部署到 GitHub Pages

`.github/workflows/deploy.yml` 已经备好，推送到 `main` 即自动构建发布。

### 已完成的部署（2026-10-16）

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/Kelvin-VTS/ProjectCurseMeme （public） |
| 站点 | https://kelvin-vts.github.io/ProjectCurseMeme/ |
| 发布方式 | push 到 `main` → GitHub Actions 自动构建发布 |
| 授权 | Git Credential Manager，凭证已存 Windows 凭据管理器，后续推送无需再授权 |

推送命令（改完内容后）：

```powershell
git add -A
git commit -m "你的说明"
git push
```

> ⚠️ 本机 `hosts` 把 GitHub 一批域名指向 `127.0.0.1`（加速器），那个转发服务会间歇性抽风。
> 推送若报 `Failed to connect to github.com:443` 或 `Connection was reset`，**直接重试两三次**通常就过了。

### 已经处理好的部署细节

| 事项 | 处理方式 |
|---|---|
| 子路径 | workflow 里用 `${{ github.event.repository.name }}` 自动注入 `VITE_BASE`，不用手改 |
| SPA 深链 | 构建时把 `index.html` 复制成 `404.html`，配合 `BrowserRouter basename={import.meta.env.BASE_URL}`，直接访问 `/<repo>/month/2026-10` 不会 404 |
| 构建时长 | 站点产物只有几百 KB，远低于 Pages 的 10 分钟部署超时 |
| 构建次数 | 用自定义 Actions workflow 发布可绕开 Pages 的 10 builds/hour 软限制（[官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)） |
| 素材位置 | 当前占位素材在 `web/public` 内，随产物发布；真实素材迁到仓库根 `media/` 后，按 workflow 里的注释切到 `VITE_MEDIA_BASE` 走 raw，产物就不会变大 |

### 本机环境注意

本机 `hosts` 把 `github.com`、`api.github.com`、`raw.githubusercontent.com` 等一批域名指向了 `127.0.0.1`（GitHub 加速器留下的）。本地那个转发服务目前是通的，但 **Windows TLS 栈在受限沙箱下拿不到凭证**，所以推送必须在沙箱外、以正常权限执行。

## 路线图

| 步骤 | 内容 | 状态 |
|---|---|---|
| S1 | 工程骨架、主题、路由 | ✅ |
| S2 | 假数据主页（瀑布流 / 月份页） | ✅ |
| S2.5 | UI 改版：浅色亮紫主题、点赞、排行榜、上传者展示、站长编辑台 | ✅ |
| S3 | `scripts/process-media.ts`：ffmpeg 转码 + sharp 缩略图 + 写入 JSON | ⬜ |
| S4 | Issue 投稿模板 + Actions 草稿 PR 流程（自动记录投稿人） | ⬜ |
| S5 | `/admin` 接上 PAT，直接提交到仓库（编辑逻辑已就绪） | ⬜ |
| S6 | 防滥用、举报入口、下架流程 | ⬜ |
| S7 | 搜索与筛选、详情弹窗左右切换、导出 JSON | ⬜ |

## 已知限制

- **访客投稿单文件上限 25MB（图片 10MB）**，这是 GitHub 附件的硬限制。
  超限时提示投稿人改用站长代传。
- **点赞不是实时共享的**，见上面的「点赞模型」。
- **站长编辑台目前只能导出 JSON 手动提交**，因为仓库和 PAT 还没有（S5 补上直接提交按钮）。
- 纯 GitHub 存储总量受仓库 1GB 建议上限约束；撞墙后切换到对象存储（R2）即可，
  前端只依赖 `VITE_MEDIA_BASE`，不用改页面代码。
- 公开站点 + UGC 有合规风险：投稿走「草稿 PR + 人工 Merge」，
  数据模型里已预留 `visible` 软删除开关。
