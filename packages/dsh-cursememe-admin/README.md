# dsh-cursememe-admin

把「阴间素材库」的站长能力做成 DSH 插件：读站点数据、上传素材、编辑条目、查 Actions 状态。

它和网页 `/admin` 走**同一条 GitHub 流水线**：

- 上传 → `staging/<批次>` → `ingest.yml`（ffmpeg 转码 / 抽帧 / 查重）→ `main`
- 编辑 → `edit/<批次>` → `edit-index.yml`（重建 manifest/rankings）→ `main`
- 查状态 → Actions API（公开仓库匿名可读）

插件不跑 ffmpeg、不碰微信数据库、不启动端口。

## 为什么是插件

WeChatAgent 不向群聊开放通用 shell。插件工具能做到：

- 按聊天授权（管理员私聊才开写权限）
- 参数有 JSON Schema，repo 写死、token 不进模型上下文
- 上传路径有白名单，防止把工作区外的文件传到公开仓库

## 配置

默认路径：`%USERPROFILE%\.dsh\secrets\cursememe-admin.json`。
改完文件不需要重启 DSH，下一次工具调用会按 mtime 重新加载。

### PAT 模式（先跑通）

```json
{
  "repo": { "owner": "Kelvin-VTS", "name": "ProjectCurseMeme" },
  "auth": {
    "mode": "pat",
    "patPath": "C:/Users/HuanZ/.dsh/secrets/cursememe-pat.txt"
  },
  "uploadRoots": ["C:/Users/HuanZ/.dsh/dsh_wechat"],
  "defaultLogin": "Kelvin-VTS"
}
```

`patPath` 指向一个只含 PAT 的文本文件；也可以用环境变量 `CURSEMEME_PAT`（优先）。
PAT 只需要 **Contents: Read and write**，仓库只选 `ProjectCurseMeme`。

### GitHub App 模式（终态）

```json
{
  "auth": {
    "mode": "app",
    "appId": 123456,
    "installationId": 12345678,
    "privateKeyPath": "C:/Users/HuanZ/.dsh/secrets/cursememe-app.pem"
  }
}
```

App 的 installation token 1 小时过期，插件会在过期前自动换新。
App token 不能调 `/user`，所以 `auth` 检查走 `/repos/{owner}/{repo}`。

### 其他可选项

| 字段 | 默认 | 说明 |
|---|---|---|
| `defaultBranch` | `main` | 读数据和建分支的基准 |
| `uploadRoots` | `[]` | 额外允许的上传根目录；工作区 `.wechatagent-files` 永远允许 |
| `maxFiles` | `10` | 单次上传文件数 |
| `maxFileBytes` | 80MB | 单文件上限（GitHub blob 硬限 100MB） |
| `allowedExtensions` | 图片/视频 | 不允许 HEIC/HEIF（sharp 读不了） |
| `mediaBase` | jsDelivr | 缩略图链接前缀 |
| `siteBase` | Pages 地址 | 条目页链接前缀 |
| `dryRun` | `false` | 全局只预览 |
| `commitAuthor` | `cursememe-bot` | 提交署名，不影响操作者身份 |

## 工具

| 工具 | 作用 |
|---|---|
| `cursememe_overview` | 总条数 / 总点赞 / 月份 / 本月前五 |
| `cursememe_search` | 按月份、标签、上传者、关键词筛 |
| `cursememe_entry` | 单条完整信息 |
| `cursememe_upload` | 路径或会话图片 → `staging/<批次>` |
| `cursememe_edit` | 点赞 / 标题 / 标签 / 可见性 / 上传者 → `edit/<批次>` |
| `cursememe_run` | 查 Actions 状态 |

上传的图片附件只支持 DSH 的 `image/png`、`image/jpeg`、`image/webp`、`image/gif`。

## CLI

不经过微信也能测同一套逻辑：

```powershell
node scripts/site-admin.mjs auth
node scripts/site-admin.mjs overview
node scripts/site-admin.mjs search --tag 抽象 --limit 5
node scripts/site-admin.mjs upload .cache\bot-smoke.png --date 2026-10-23 --tags bot,smoke --group bot-test --dry-run
node scripts/site-admin.mjs upload .cache\bot-smoke.png --date 2026-10-23 --tags bot,smoke --group bot-test
node scripts/site-admin.mjs edit <id> --title "连通性测试" --visible false
node scripts/site-admin.mjs status staging/<批次>
```

`--config <path>` 可以换配置文件；`--dry-run` 只预览，不创建 blob/commit/分支。

## 装进 DSH

1. 在 `%USERPROFILE%\.dsh\profiles\desktop\package.json` 的 `dependencies` 里加：
   `"dsh-cursememe-admin": "link:E:/Doc/DSHWorkPlace/ProjectCurseMeme/packages/dsh-cursememe-admin"`
2. 在同一个文件的 `dsh.profile.bundles` 里加 `"dsh-cursememe-admin"`。
3. 在该 profile 目录跑 `pnpm install`，重启 DSH。
4. WeChatAgent → 管理员私聊 → 设置此聊天 → 助手模式 → 技能与工具 → 勾选上面 6 个工具。
5. 群聊不要授权写工具；最多授权 `cursememe_overview` / `cursememe_search` / `cursememe_entry`。

## 安全边界

- **repo 写死**：工具参数里没有 owner/repo/token。
- **上传白名单**：只接受当前工作区 `.wechatagent-files/**`、`uploadRoots`、或当前会话图片附件；`realpath` 校验，拒绝软链接逃逸。
- **永远不直接推 main**：只推 `staging/` 和 `edit/`，派生文件交给 Actions。
- **不做删除**：只支持 `visible:false` 软下架。
- **不把 token 交给模型**：token 只在插件进程里；工具返回里不出现 Authorization。
- **群聊只读**：写工具只应在管理员私聊授权；插件本身看不到聊天身份，边界由 WeChatAgent 的按聊天授权承担。
