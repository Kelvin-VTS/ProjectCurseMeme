#!/usr/bin/env node
/**
 * 媒体入库管线（S3）
 *
 * 把 inbox/ 里的原始素材（微信导出的 HEVC 视频、手机直出的大图）处理成网站能直接用，
 * 并写进 web/public/data/months/*.json。
 *
 *   1. 视频：HEVC/超分辨率 → H.264 + faststart；本来就合规的无损重封装（秒级）
 *   2. 封面：抽 5 个候选帧按对比度打分，专治「首帧是黑屏」——微信视频的常见毛病
 *   3. 缩略图：poster(≤1280) + thumb(≤640)，WebP，重编码顺带丢掉全部 EXIF
 *   4. 查重：sha256，已入库的直接跳过
 *   5. 归月：--date > EXIF > 路径里的年月 > 视频 creation_time > 文件修改时间
 *
 * 用法：
 *   npm run media                                  # 处理 inbox/
 *   npm run media -- --date 2026-10-05 --group G07 --tags 抽象,搞笑
 *   npm run media -- --dry-run                     # 只报告，不写任何文件
 *   npm run media -- "D:\微信导出\2026-10"          # 处理指定目录
 *
 * 处理完必须重建索引：npm run index
 */

import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Entry } from '../web/src/types.ts';
import {
  extractFrame,
  fitSize,
  needsTranscode,
  posterTimes,
  probeVideo,
  remuxVideo,
  resolveTools,
  transcodeVideo,
  type ToolPaths,
} from './lib/ffmpeg.ts';
import { readImageMeta, scoreFrame, toWebp } from './lib/images.ts';
import { REPO_ROOT, toRepoPath } from './lib/paths.ts';
import { entryId, fileSize, loadHashIndex, monthOf, sha256File, upsertEntry } from './lib/store.ts';

// ---------------------------------------------------------------- 配置

/** 站长默认署名。访客投稿走 S4 的 Issue 流程，署名由 Issue 作者决定。 */
const DEFAULT_LOGIN = 'Kelvin-VTS';

const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.3gp', '.wmv', '.flv', '.mts', '.m2ts',
]);

// ---------------------------------------------------------------- 参数

interface Options {
  inbox: string;
  mediaRoot: string;
  dataRoot: string;
  workDir: string;
  date?: string;
  group?: string;
  tags: string[];
  login: string;
  maxEdge: number;
  crf: number;
  preset: string;
  dryRun: boolean;
  force: boolean;
  stripExif: boolean;
  help: boolean;
  paths: string[];
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    inbox: path.join(REPO_ROOT, 'inbox'),
    mediaRoot: path.join(REPO_ROOT, 'media'),
    dataRoot: path.join(REPO_ROOT, 'web', 'public', 'data'),
    workDir: path.join(REPO_ROOT, '.cache', 'process'),
    tags: [],
    login: DEFAULT_LOGIN,
    maxEdge: 1280,
    crf: 24,
    preset: 'veryfast',
    dryRun: false,
    force: false,
    stripExif: false,
    help: false,
    paths: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = (): string => {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 后面缺少取值`);
      i += 1;
      return value;
    };

    switch (arg) {
      case '-h':
      case '--help': opts.help = true; break;
      case '--inbox': opts.inbox = path.resolve(take()); break;
      case '--media-root': opts.mediaRoot = path.resolve(take()); break;
      case '--data-root': opts.dataRoot = path.resolve(take()); break;
      case '--date': opts.date = take(); break;
      case '--group': opts.group = take(); break;
      case '--tags': opts.tags = take().split(/[,，]/).map((t) => t.trim()).filter(Boolean); break;
      case '--login': opts.login = take(); break;
      case '--max-edge': opts.maxEdge = Number(take()); break;
      case '--crf': opts.crf = Number(take()); break;
      case '--preset': opts.preset = take(); break;
      case '--strip-exif': opts.stripExif = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--force': opts.force = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`未知参数 ${arg}`);
        opts.paths.push(path.resolve(arg));
    }
  }

  if (opts.date && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error(`--date 需要 YYYY-MM-DD 格式，收到 ${opts.date}`);
  }
  if (!Number.isFinite(opts.maxEdge) || opts.maxEdge < 240) {
    throw new Error(`--max-edge 不合理：${opts.maxEdge}`);
  }
  return opts;
}

const HELP = `
媒体入库管线

用法
  npm run media [选项] [文件或目录...]

选项
  --date <YYYY-MM-DD>   强制指定日期（覆盖自动推断）
  --group <名称>        来源 / 群名
  --tags <a,b>          标签，逗号分隔
  --login <GitHub 名>   上传者署名，默认 ${DEFAULT_LOGIN}
  --inbox <目录>        默认 inbox/
  --max-edge <像素>     长边上限，默认 1280
  --crf <数值>          H.264 质量，越小越清晰，默认 24
  --strip-exif          图片原图改为重编码（丢掉 EXIF，但不再是原始字节）
  --dry-run             只报告，不写任何文件
  --force               忽略查重，强制重新入库

不传路径时扫描 inbox/。
`;

// ---------------------------------------------------------------- 日期推断

interface DateChoice {
  date: string;
  source: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatLocalDate(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** 从路径里的年月推断 —— 微信 PC 端 FileStorage 就是按年月分目录的，这条最准 */
function matchPathDate(file: string): DateChoice | null {
  const match = /(20\d{2})[-_年/](\d{1,2})(?:[-_月/](\d{1,2}))?/.exec(file);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : null;
  if (month < 1 || month > 12) return null;
  if (day !== null && (day < 1 || day > 31)) return null;
  if (year < 2000 || year > 2100) return null;

  const date = day === null ? `${match[1]}-${pad(month)}-01` : `${match[1]}-${pad(month)}-${pad(day)}`;
  return { date, source: `路径推断（命中 “${match[0]}”）` };
}

async function resolveDate(
  file: string,
  opts: Options,
  exifDate: string | null,
  videoDate: string | null,
): Promise<DateChoice> {
  if (opts.date) return { date: opts.date, source: '命令行 --date' };
  if (exifDate) return { date: exifDate, source: 'EXIF 拍摄时间' };

  const fromPath = matchPathDate(file);
  if (fromPath) return fromPath;

  if (videoDate) return { date: videoDate, source: '视频容器 creation_time' };

  const info = await stat(file);
  return {
    date: formatLocalDate(info.mtime),
    source: '文件修改时间（最不可靠，建议用 --date 覆盖）',
  };
}

// ---------------------------------------------------------------- 文件收集

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...(await walk(full)));
    else if (item.isFile()) out.push(full);
  }
  return out.sort();
}

async function collectFiles(opts: Options): Promise<string[]> {
  if (opts.paths.length > 0) {
    const out: string[] = [];
    for (const target of opts.paths) {
      const info = await stat(target);
      if (info.isDirectory()) out.push(...(await walk(target)));
      else out.push(target);
    }
    return out;
  }
  try {
    return await walk(opts.inbox);
  } catch {
    return [];
  }
}

function kindOf(file: string): 'image' | 'video' | null {
  const ext = path.extname(file).toLowerCase();
  if (ext in IMAGE_MIME) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

/** jsDelivr 对 GitHub 源的单文件上限；超了线上就是一个 403 */
const CDN_FILE_LIMIT = 20 * 1024 * 1024;

function warnIfOverCdnLimit(bytes: number): void {
  if (bytes > CDN_FILE_LIMIT) {
    console.log(
      `      ⚠ 产物 ${(bytes / 1024 / 1024).toFixed(1)} MB 超过 CDN 单文件上限 20MB，线上会加载失败；` +
        `建议调小 --max-edge 或调大 --crf`,
    );
  }
}

// ---------------------------------------------------------------- 条目构造

interface CommonFields {
  id: string;
  date: string;
  hash: string;
  media: string;
  poster: string;
  thumb: string;
  width: number;
  height: number;
  size: number;
  mime: string;
  title?: string;
}

function buildEntry(opts: Options, fields: CommonFields, extra: Partial<Entry>): Entry {
  const now = new Date().toISOString();
  return {
    id: fields.id,
    kind: extra.kind ?? 'image',
    date: fields.date,
    createdAt: now,
    media: fields.media,
    poster: fields.poster,
    thumb: fields.thumb,
    width: fields.width,
    height: fields.height,
    size: fields.size,
    mime: fields.mime,
    hash: fields.hash,
    likes: 0,
    contributor: { login: opts.login, avatar: `https://github.com/${opts.login}.png` },
    via: 'cli',
    visible: true,
    processedAt: now,
    ...(opts.group ? { group: opts.group } : {}),
    ...(opts.tags.length > 0 ? { tags: opts.tags } : {}),
    ...(fields.title ? { title: fields.title } : {}),
    ...extra,
  };
}

// ---------------------------------------------------------------- 处理

interface Outcome {
  status: 'added' | 'skipped' | 'failed';
  file: string;
  detail: string;
}

let toolsPromise: Promise<ToolPaths> | null = null;
/** 只有真遇到视频才去解析 ffmpeg，纯图片导入不该因为缺 ffmpeg 而失败 */
function tools(): Promise<ToolPaths> {
  toolsPromise ??= resolveTools();
  return toolsPromise;
}

async function processImage(
  file: string,
  opts: Options,
  index: Map<string, Entry>,
): Promise<Outcome> {
  const hash = await sha256File(file);
  const existing = index.get(hash);
  if (existing && !opts.force) {
    return { status: 'skipped', file, detail: `内容已存在（id ${existing.id}，${existing.date}）` };
  }

  const meta = await readImageMeta(file);
  const { date, source } = await resolveDate(file, opts, meta.exifDate, null);
  const id = entryId(hash);
  const month = monthOf(date);
  const dir = path.join(opts.mediaRoot, month);
  const ext = path.extname(file).toLowerCase();

  console.log(`      尺寸 ${meta.width}x${meta.height}  ${((await fileSize(file)) / 1024).toFixed(0)} KB  格式 ${meta.format}`);
  console.log(`      日期 ${date}（${source}）`);
  if (meta.animated) console.log('      动图：原图保留动画，封面取第一帧');
  if (meta.hasExif) console.log('      ⚠ 原图含 EXIF（可能带 GPS / 设备信息），已入库原图；需要清除请加 --strip-exif');

  if (opts.dryRun) {
    return { status: 'added', file, detail: `[dry-run] 将写入 ${toRepoPath(path.join(dir, `${id}${ext}`))}` };
  }

  await mkdir(dir, { recursive: true });

  // 原图：默认原样拷贝（保真、可下载原始文件）；动图必须原样保留才不丢动画
  const keepOriginal = !opts.stripExif || meta.animated;
  let mediaPath: string;
  let mediaMime: string;
  if (keepOriginal) {
    mediaPath = path.join(dir, `${id}${ext}`);
    await copyFile(file, mediaPath);
    mediaMime = IMAGE_MIME[ext] ?? 'application/octet-stream';
  } else {
    mediaPath = path.join(dir, `${id}.webp`);
    await toWebp(file, mediaPath, 4096, 90);
    mediaMime = 'image/webp';
  }

  const poster = await toWebp(file, path.join(dir, `${id}.poster.webp`), opts.maxEdge, 82);
  const thumb = await toWebp(file, path.join(dir, `${id}.thumb.webp`), 640, 76);

  const mediaSize = await fileSize(mediaPath);
  warnIfOverCdnLimit(mediaSize);

  const entry = buildEntry(
    opts,
    {
      id,
      date,
      hash,
      media: toRepoPath(mediaPath),
      poster: toRepoPath(path.join(dir, `${id}.poster.webp`)),
      thumb: toRepoPath(path.join(dir, `${id}.thumb.webp`)),
      width: meta.width,
      height: meta.height,
      size: mediaSize,
      mime: mediaMime,
    },
    { kind: 'image' },
  );

  console.log(`      poster ${poster.width}x${poster.height} ${(poster.bytes / 1024).toFixed(0)} KB  thumb ${thumb.width}x${thumb.height} ${(thumb.bytes / 1024).toFixed(0)} KB`);

  const result = await upsertEntry(opts.dataRoot, entry);
  // 立刻回写索引：否则同一批次里的重复文件会白干一遍（id 相同会覆盖，但浪费一次转码）
  index.set(hash, entry);
  return { status: 'added', file, detail: `id ${id} → ${path.basename(result.file)}` };
}

async function processVideo(
  file: string,
  opts: Options,
  index: Map<string, Entry>,
): Promise<Outcome> {
  const hash = await sha256File(file);
  const existing = index.get(hash);
  if (existing && !opts.force) {
    return { status: 'skipped', file, detail: `内容已存在（id ${existing.id}，${existing.date}）` };
  }

  const resolved = await tools();
  const info = await probeVideo(file, resolved);
  const videoDate = info.creationTime && !Number.isNaN(Date.parse(info.creationTime))
    ? formatLocalDate(new Date(info.creationTime))
    : null;
  const { date, source } = await resolveDate(file, opts, null, videoDate);
  const id = entryId(hash);
  const month = monthOf(date);
  const dir = path.join(opts.mediaRoot, month);

  console.log(`      尺寸 ${info.width}x${info.height}  时长 ${info.duration.toFixed(1)}s  ${(info.bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`      编码 ${info.videoCodec || '?'}${info.audioCodec ? ` / ${info.audioCodec}` : '（无音轨）'}`);
  console.log(`      日期 ${date}（${source}）`);

  const decision = needsTranscode(info, opts.maxEdge);
  console.log(`      ${decision.needed ? '转码' : '重封装'}：${decision.reason}`);

  if (opts.dryRun) {
    return { status: 'added', file, detail: `[dry-run] 将写入 ${toRepoPath(path.join(dir, `${id}.mp4`))}` };
  }

  await mkdir(dir, { recursive: true });
  const mediaPath = path.join(dir, `${id}.mp4`);

  if (decision.needed) {
    const target = fitSize(info.width, info.height, opts.maxEdge);
    await transcodeVideo(file, mediaPath, resolved, {
      width: target.width,
      height: target.height,
      crf: opts.crf,
      preset: opts.preset,
    });
  } else {
    await remuxVideo(file, mediaPath, resolved);
  }

  const outInfo = await probeVideo(mediaPath, resolved);

  // 抽候选帧打分，专治首帧黑屏。workDir 必须先建出来，否则抽帧全部写不进去。
  await mkdir(opts.workDir, { recursive: true });
  const candidates: Array<{ time: number; score: number }> = [];
  for (const time of posterTimes(outInfo.duration)) {
    const probeFile = path.join(opts.workDir, `candidate-${time.toFixed(2)}.jpg`);
    try {
      await extractFrame(mediaPath, time, probeFile, resolved, 320);
      candidates.push({ time, score: await scoreFrame(probeFile) });
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      console.log(`      ⚠ ${time.toFixed(1)}s 抽帧失败，跳过该候选：${reason}`);
    }
  }
  if (candidates.length === 0) throw new Error('所有候选帧都抽取失败，无法生成封面');

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  console.log(
    `      候选帧 ${candidates.map((c) => `${c.time.toFixed(1)}s=${c.score.toFixed(1)}`).join('  ')}  →  选 ${best.time.toFixed(1)}s`,
  );

  const frameFile = path.join(opts.workDir, 'poster-frame.jpg');
  await extractFrame(mediaPath, best.time, frameFile, resolved);

  const poster = await toWebp(frameFile, path.join(dir, `${id}.poster.webp`), opts.maxEdge, 82);
  const thumb = await toWebp(frameFile, path.join(dir, `${id}.thumb.webp`), 640, 76);
  console.log(
    `      封面 ${poster.width}x${poster.height} ${(poster.bytes / 1024).toFixed(0)} KB  thumb ${thumb.width}x${thumb.height} ${(thumb.bytes / 1024).toFixed(0)} KB`,
  );

  const entry = buildEntry(
    opts,
    {
      id,
      date,
      hash,
      media: toRepoPath(mediaPath),
      poster: toRepoPath(path.join(dir, `${id}.poster.webp`)),
      thumb: toRepoPath(path.join(dir, `${id}.thumb.webp`)),
      width: outInfo.width,
      height: outInfo.height,
      size: await fileSize(mediaPath),
      mime: 'video/mp4',
    },
    { kind: 'video', duration: Number(outInfo.duration.toFixed(2)) },
  );

  const outBytes = await fileSize(mediaPath);
  const ratio = info.bytes > 0 ? (1 - outBytes / info.bytes) * 100 : 0;
  console.log(`      输出 ${outInfo.width}x${outInfo.height}  ${(outBytes / 1024 / 1024).toFixed(2)} MB（体积变化 ${ratio >= 0 ? '-' : '+'}${Math.abs(ratio).toFixed(0)}%）`);
  warnIfOverCdnLimit(outBytes);

  const result = await upsertEntry(opts.dataRoot, entry);
  index.set(hash, entry);
  return { status: 'added', file, detail: `id ${id} → ${path.basename(result.file)}` };
}

// ---------------------------------------------------------------- 主流程

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP.trim());
    return;
  }

  const all = await collectFiles(opts);
  const supported = all.filter((file) => kindOf(file) !== null);
  const unsupported = all.length - supported.length;

  console.log(`扫描 ${opts.paths.length > 0 ? opts.paths.map((p) => path.relative(REPO_ROOT, p) || '.').join(', ') : path.relative(REPO_ROOT, opts.inbox)}`);
  console.log(`找到 ${all.length} 个文件，其中可处理 ${supported.length} 个${unsupported > 0 ? `，忽略 ${unsupported} 个不支持的类型` : ''}`);
  if (opts.dryRun) console.log('（dry-run：不会写入任何文件）');
  console.log('');

  if (supported.length === 0) {
    console.log(`没有可处理的文件。把素材丢进 ${path.relative(REPO_ROOT, opts.inbox)}/，或用 npm run media -- <目录> 指定路径。`);
    return;
  }

  const index = await loadHashIndex(opts.dataRoot);
  console.log(`已入库 ${index.size} 条，用于查重\n`);

  const outcomes: Outcome[] = [];
  for (let i = 0; i < supported.length; i += 1) {
    const file = supported[i];
    const kind = kindOf(file)!;
    console.log(`[${i + 1}/${supported.length}] ${kind === 'video' ? '视频' : '图片'}  ${path.relative(REPO_ROOT, file)}`);
    try {
      const outcome = kind === 'video'
        ? await processVideo(file, opts, index)
        : await processImage(file, opts, index);
      outcomes.push(outcome);
      console.log(`      ${outcome.status === 'skipped' ? '跳过' : '完成'}：${outcome.detail}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({ status: 'failed', file, detail: message });
      console.log(`      ❌ 失败：${message}\n`);
    }
  }

  const added = outcomes.filter((o) => o.status === 'added');
  const skipped = outcomes.filter((o) => o.status === 'skipped');
  const failed = outcomes.filter((o) => o.status === 'failed');

  console.log('─'.repeat(60));
  console.log(`新增 ${added.length}  跳过 ${skipped.length}  失败 ${failed.length}`);

  if (failed.length > 0) {
    console.log('\n失败清单：');
    for (const item of failed) console.log(`  ${path.relative(REPO_ROOT, item.file)}\n    ${item.detail}`);
    process.exitCode = 1;
  }

  if (added.length > 0 && !opts.dryRun) {
    console.log('\n下一步：npm run index   （重建 manifest.json 与 rankings.json）');
  }
}

main().catch((error: unknown) => {
  console.error(`\n出错了：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
