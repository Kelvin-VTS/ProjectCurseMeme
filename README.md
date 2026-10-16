# 阴间素材库

微信群抽象图片 / 视频的个人归档站。按月份分类展示，支持多人投稿。

当前进度：**S1 骨架 + S2 假数据主页 + UI 改版 + 线上部署 + S3 媒体入库管线**。

线上地址：**https://kelvin-vts.github.io/ProjectCurseMeme/**

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite 7 + React 19 + TypeScript |
| 样式 | Tailwind CSS v4（`@theme` 语义化 token，浅色主题） |
| 路由 | React Router v7（SPA） |
| 数据 | 静态 JSON（`manifest.json` + `months/yyyy-mm.json` + `rankings.json`） |
| 媒体处理 | Node 24 原生跑 TS + ffmpeg（转码/抽帧）+ sharp（缩略图） |
| 托管 | GitHub Pages（前端）+ jsDelivr CDN 读仓库内 `media/` |
| 投稿 | GitHub Issue 表单 → Actions 处理 → 草稿 PR → 人工 Merge |

## 目录结构

```
ProjectCurseMeme/
├─ package.json                 工具链依赖（前端在 web/，两者互不干扰）
├─ inbox/                       待处理素材投放区（原始文件不提交）
├─ media/                       媒体真身：原文件 + poster + thumb，提交进仓库
│  └─ placeholder/              S2 占位图（会被真实素材替换）
├─ assets/brand/                品牌源文件（purpleicon.png 是图标母版）
├─ web/                         前端
│  ├─ src/
│  │  ├─ assets/logo.webp       顶栏 logo（3.3 KB，Vite 直接内联进 JS）
│  │  ├─ components/            布局、瀑布流、卡片、点赞、榜单、预览层
│  │  ├─ lib/
│  │  │  ├─ data.ts             地址解析、manifest / 月份 / 榜单读取
│  │  │  ├─ likes.tsx           访客本地点亮状态（可整体替换成共享计数）
│  │  │  ├─ date.ts             纯字符串日期工具，零 new Date()
│  │  │  └─ site.ts             站点文案
│  │  ├─ pages/                 Home / MonthPage / Admin
│  │  └─ types.ts               Entry / Manifest / Rankings 数据契约
│  ├─ vite.config.ts            SPA 404 回退 + 开发期媒体中间件
│  └─ public/
│     ├─ data/                  索引与榜单（提交进仓库）
│     ├─ icon-192.png           favicon / apple-touch-icon
│     └─ robots.txt
└─ scripts/
   ├─ process-media.ts          S3 入库管线（ffmpeg 转码 + 抽帧选封面 + 写 JSON）
   ├─ build-index.mjs           派生 manifest.json 与 rankings.json
   ├─ make-icons.py             从 assets/brand/ 生成 favicon 与顶栏 logo
   ├─ seed-fake-data.py         生成 S2 假数据（开发期脚手架）
   ├─ lib/ffmpeg.ts             二进制定位、探测、转码、抽帧
   ├─ lib/images.ts             sharp 元数据 / 缩略图 / 封面评分
   ├─ lib/store.ts              sha256 查重、月份 JSON 读写
   └─ lib/paths.ts              仓库根路径与相对路径换算
```

## 媒体入库（S3）

```powershell
# 把素材丢进 inbox/，或者用 -- 指定任意目录
npm run media
npm run media -- "D:\微信导出\2026-10" --group G07 --tags 抽象,搞笑
npm run media -- --dry-run                 # 只报告，不写任何文件
npm run index                              # 重建 manifest.json 与 rankings.json
```

管线做五件事：

| 步骤 | 做法 | 为什么 |
|---|---|---|
| 视频转码 | 非 H.264 或超分辨率 → H.264 + faststart；本来就合规的**无损重封装**（秒级） | 微信视频大量是 HEVC/H.265，在 Chrome / Firefox 上直接黑屏 |
| 封面选帧 | 抽 5 个候选帧（10%~85% 位置）按对比度打分，选最高的 | **很多视频首帧是黑的**，直接取第 0 帧会得到全黑封面 |
| 缩略图 | `poster`(≤1280) + `thumb`(≤640)，WebP | 重编码顺带丢掉全部 EXIF（GPS / 设备信息） |
| 查重 | 源文件 sha256，已入库直接跳过（含同批次内重复） | 同一个视频在群里被转发多次是常态 |
| 归月 | `--date` > EXIF > 路径年月 > 视频 creation_time > 文件修改时间 | 微信 PC 端按年月分目录，路径推断往往最准；文件修改时间最不可靠 |

**实测效果**（专门造了个前 2 秒纯黑的 HEVC 视频）：

| 取帧方式 | 平均亮度 | 近黑像素占比 |
|---|---|---|
| 直接取第 0 帧 | 0.0 / 255 | 100.0% |
| 管线抽帧打分选帧 | 127.2 / 255 | 0.0% |

### ffmpeg 从哪来

按优先级查找（`scripts/lib/ffmpeg.ts`）：

1. `FFMPEG_PATH` / `FFPROBE_PATH` 环境变量
2. 系统 `PATH`（GitHub Actions 的 runner 自带，线上走这条）
3. `.cache/tools/`（本地放静态二进制的地方，已 gitignore）
4. `node_modules/@ffmpeg-installer/`（`npm install` 时装的，本机正在用这条）

> ⚠️ npm 装的 ffmpeg 是 **2018 年的老版本**（那个包年久失修），ffprobe 是 2023 的。
> 处理特殊编码遇到问题时，`winget install Gyan.FFmpeg` 装个新版就会自动优先使用。

### 参数

| 参数 | 说明 |
|---|---|
| `--date <YYYY-MM-DD>` | 强制日期，覆盖自动推断 |
| `--group` / `--tags` / `--login` | 来源、标签、上传者署名 |
| `--max-edge <px>` | 长边上限，默认 1280 |
| `--crf <n>` | H.264 质量，越小越清晰，默认 24 |
| `--strip-exif` | 图片原图改为重编码（丢掉 EXIF，但不再是原始字节） |
| `--dry-run` / `--force` | 只报告 / 忽略查重 |

## 数据管线

**唯一数据源是月份 JSON**。`manifest.json` 和 `rankings.json` 都是派生文件，不允许手写：

```
站长编辑台（/admin）─┐
process-media.ts    ─┼─→ web/public/data/months/*.json
S4 Actions 投稿流程  ─┘              │
                                     ▼
                       node scripts/build-index.mjs
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
         manifest.json                            rankings.json
  （总数 / 总点赞 / 月份索引）            （本月榜 / 年度榜，按点赞数）
```

这样榜单计算只有一份实现，站长手工编辑和 Actions 自动入库走同一条路，
不会出现「页面算的榜单和脚本算的不一致」。

`build-index.mjs` 支持 `--data-root <目录>`，方便在测试数据上验证而不碰真实数据。

## 开发

> 本机 PowerShell 执行策略是默认的 Restricted，`npm.ps1` 会被拦住。
> **一律用 `npm.cmd`**，或者自己执行一次
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

```powershell
# 前端
cd web
npm.cmd install
npm.cmd run dev        # http://127.0.0.1:5173
npm.cmd run build      # 类型检查 + 构建

# 工具链（在仓库根目录）
npm.cmd install
npm.cmd run media      # 媒体入库
npm.cmd run index      # 重建索引与榜单
npm.cmd run typecheck  # 检查 scripts/ 的 TypeScript
```

`scripts/*.ts` 用 **Node 24 的原生类型擦除**直接执行，不需要 tsx、也不需要编译步骤；
类型正确性由 `npm run typecheck`（独立的 `scripts/tsconfig.json`）保证。

## 点赞模型（必读）

这是个纯静态站，没有数据库，所以点赞分两层：

| | 存在哪 | 谁维护 |
|---|---|---|
| **基准计数** | 仓库 JSON 的 `likes` 字段 | 站长（`/admin` 编辑台） |
| **本机点亮** | 访客浏览器的 localStorage | 访客自己 |
| **显示数字** | 上面两者相加 | — |

因此：**不同人看到的同一条内容可能差 1**，排行榜按基准计数排序。
访客无法刷高全局数字，站长也不会被恶意点击影响。

想升级成真正的全网共享计数，只需替换 `web/src/lib/likes.tsx` 这一层
（后端 KV，或走 GitHub Issue 的 👍 reactions），组件代码一行都不用改。

## 关键设计决定

1. **媒体不进构建产物**。`media/` 在 `web/public` **之外**，开发期由 `vite.config.ts`
   里的中间件服务（带 Range 支持，视频能拖进度条），线上由 `VITE_MEDIA_BASE` 指向 CDN。
   产物因此恒定在 ~330 KB，不会随素材增长撞上 Pages 的「已发布站点 ≤1GB」上限。
2. **媒体走 jsDelivr 而不是 raw.githubusercontent.com**。这是**实测**决定的：
   本机 raw 请求 25 秒无响应（hosts 劫持 + 加速器不转发），jsDelivr 1.07 秒返回 200。
   代价是 jsDelivr 对 GitHub 源有 **20MB 单文件上限**，管线超过会告警。
3. **每条 Entry 必存 `width`/`height`**。瀑布流靠它做 `aspect-ratio` 占位，
   图片没加载出来时高度就是对的，滚动不抖动。
4. **日期全程走字符串**。`lib/date.ts` 里没有任何 `new Date()`，
   EXIF 也直接从二进制里抠 ASCII 日期串，彻底避开时区 off-by-one。
5. **视频卡片不渲染 `<video>`**。网格里只有首帧海报 + 播放角标，
   点开预览层才挂载 video 元素，否则一屏二十个视频会拖垮手机。
6. **瀑布流自己分列**，不用 CSS `columns`。后者是列优先排版，会打乱时间倒序。
7. **卡片外层不是 `<button>`**。点赞是卡片内的独立按钮，HTML 不允许按钮嵌套。
   卡片结构变化时要同步改 `MasonryGrid` 里的 `estimateMetaHeight`，否则列高会算歪。
8. **`visible: false` 是软下架**。条目留在仓库里、可从 git 历史恢复，
   但不会出现在站点、`manifest` 和榜单里。
9. **dev server 用轮询监听**。Windows 上编辑器做原子替换会让 Vite 的 `fs.watch`
   抛 `EBUSY` 直接崩掉，`vite.config.ts` 里已改成 `usePolling`。

## 环境变量

| 变量 | 作用 |
|---|---|
| `VITE_BASE` | Pages 项目站点的子路径，如 `/ProjectCurseMeme/` |
| `VITE_DATA_BASE` | 数据根路径，默认 `/data`（随产物发布） |
| `VITE_MEDIA_BASE` | 媒体根，如 `https://cdn.jsdelivr.net/gh/<user>/<repo>@main` |
| `VITE_DATA_VERSION` | 数据版本参数，用于绕开 CDN 缓存 |

## 部署到 GitHub Pages

`.github/workflows/deploy.yml` 已经备好，推送到 `main` 即自动构建发布。

### 已完成（2026-10-16）

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/Kelvin-VTS/ProjectCurseMeme （public） |
| 站点 | https://kelvin-vts.github.io/ProjectCurseMeme/ |
| 发布方式 | push 到 `main` → GitHub Actions 自动构建发布 |
| 授权 | Git Credential Manager，凭证已存 Windows 凭据管理器，后续推送无需再授权 |

推送命令：

```powershell
git add -A
git commit -m "你的说明"
git push
```

> ⚠️ 本机 `hosts` 把 GitHub 一批域名指向 `127.0.0.1`（加速器），转发服务会间歇性抽风。
> 推送报 `Failed to connect to github.com:443` 或 `Connection was reset` 时，**重试两三次**通常就过了。

### 部署细节

| 事项 | 处理方式 |
|---|---|
| 子路径 | workflow 用 `${{ github.event.repository.name }}` 自动注入 `VITE_BASE` |
| SPA 深链 | 构建时把 `index.html` 复制成 `404.html`，配合 `basename={import.meta.env.BASE_URL}`，直接访问 `/<repo>/month/2026-10` 不 404 |
| 媒体 | 在仓库根 `media/`，不进产物，线上由 jsDelivr 读取 |
| 构建时长 | 产物 ~330 KB，远低于 Pages 的 10 分钟部署超时 |
| 构建次数 | 自定义 Actions workflow 发布可绕开 10 builds/hour 软限制（[官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)） |

## 路线图

| 步骤 | 内容 | 状态 |
|---|---|---|
| S1 | 工程骨架、主题、路由 | ✅ |
| S2 | 假数据主页（瀑布流 / 月份页） | ✅ |
| S2.5 | UI 改版：浅色亮紫主题、点赞、排行榜、上传者展示、站长编辑台 | ✅ |
| S2.8 | 线上部署（Pages + Actions + SPA 回退） | ✅ |
| S3 | 媒体入库管线：ffmpeg 转码 / 抽帧选封面 / sharp 缩略图 / 查重 / 归月 | ✅ |
| S4 | Issue 投稿模板 + Actions 草稿 PR 流程（自动记录投稿人） | ⬜ |
| S5 | `/admin` 接上 PAT，直接提交到仓库（编辑逻辑已就绪） | ⬜ |
| S6 | 防滥用、举报入口、下架流程 | ⬜ |
| S7 | 搜索与筛选、详情弹窗左右切换、导出 JSON | ⬜ |

## 已知限制

- **HEIC / HEIF 图片可能读不了**。sharp 的预编译包出于授权原因没带 libheif，
  遇到会明确报错。iPhone 直出的照片需要先转成 JPEG。
- **访客投稿单文件上限 25MB（图片 10MB）**，这是 GitHub 附件的硬限制；
  站长直传路径不受此限。
- **CDN 单文件 20MB 上限**（jsDelivr 对 GitHub 源的限制），管线超限会告警。
- **点赞不是实时共享的**，见上面的「点赞模型」。
- **站长编辑台目前只能导出 JSON 手动提交**（S5 补上直接提交按钮）。
- 仓库总量受 GitHub 建议的 1GB 上限约束。撞墙后切到对象存储（R2）即可，
  前端只依赖 `VITE_MEDIA_BASE`，不用改页面代码。
- 公开站点 + UGC 有合规风险：投稿走「草稿 PR + 人工 Merge」，
  数据模型里已预留 `visible` 软删除开关。
