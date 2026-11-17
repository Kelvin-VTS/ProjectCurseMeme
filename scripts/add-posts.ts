#!/usr/bin/env node
/**
 * 把 job.json 里的 `posts` 写成 kind:'text' 的条目（纯文字记录）。
 *
 * 为什么不复用 process-media.ts：那条管线围绕**文件**做的 —— 探测、转码、抽帧、
 * 缩略图、按内容哈希去重。文字记录没有文件，硬塞进去会让它到处 if 判断。
 * 这里只做「构造条目 + 并入月份 JSON」，去重与落盘复用同一套 lib/store.ts。
 *
 * 用法（由 ingest-batch.mjs 调用，也可以本地单独跑）：
 *   node scripts/add-posts.ts --incoming incoming [--data-root web/public/data] [--report .cache/posts-report.json]
 *
 * job.json 里的 posts 形状：
 *   { "posts": [ { "title": "可选", "note": "Markdown 正文" } ], "login": "署名", "date": "YYYY-MM-DD", ... }
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Entry } from '../web/src/types.ts';
import { entryId, loadHashIndex, upsertEntry } from './lib/store.ts';
import { REPO_ROOT, toRepoPath } from './lib/paths.ts';

interface Options {
  incoming: string;
  dataRoot: string;
  report?: string;
  dryRun: boolean;
}

interface PostInput {
  title?: string;
  note?: string;
  /** 单条可以单独指定日期，缺省用批次的 date */
  date?: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    incoming: path.join(REPO_ROOT, 'incoming'),
    dataRoot: path.join(REPO_ROOT, 'web', 'public', 'data'),
    dryRun: false,
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
      case '--incoming': opts.incoming = path.resolve(take()); break;
      case '--data-root': opts.dataRoot = path.resolve(take()); break;
      case '--report': opts.report = path.resolve(take()); break;
      case '--dry-run': opts.dryRun = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`未知参数 ${arg}`);
    }
  }
  return opts;
}

/** 只接受合法的 YYYY-MM-DD，其它一律退回今天（本地时区，和前端一致） */
function resolveDate(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function cleanText(raw: unknown, max: number): string {
  const text = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim() : '';
  return text.slice(0, max);
}

interface Outcome {
  index: number;
  status: 'added' | 'skipped' | 'failed';
  detail: string;
  id?: string;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const jobRaw = await readFile(path.join(opts.incoming, 'job.json'), 'utf8');
  const job = JSON.parse(jobRaw) as Record<string, unknown>;
  const posts = Array.isArray(job.posts) ? (job.posts as PostInput[]) : [];

  if (posts.length === 0) {
    console.log('job.json 里没有 posts，跳过');
    return;
  }

  const login =
    typeof job.login === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(job.login) ? job.login : 'unknown';
  const group = typeof job.group === 'string' ? job.group.trim() : '';
  const tags = Array.isArray(job.tags)
    ? job.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8)
    : [];
  const batchDate = typeof job.date === 'string' ? job.date : undefined;

  const index = await loadHashIndex(opts.dataRoot);
  console.log(`已入库 ${index.size} 条，用于查重`);

  const outcomes: Outcome[] = [];

  for (let i = 0; i < posts.length; i += 1) {
    const post = posts[i] ?? {};
    const note = cleanText(post.note, 20000);
    const title = cleanText(post.title, 120);

    if (!note) {
      outcomes.push({ index: i, status: 'failed', detail: '正文为空' });
      console.error(`❌ 第 ${i + 1} 条：正文为空`);
      continue;
    }

    const date = resolveDate(post.date ?? batchDate);

    // 去重键：同一署名 + 同一天 + 同样的标题与正文 = 同一条记录。
    // 这样重复提交不会产生第二条，也不会把已有点赞数清零。
    const canonical = [login, date, title, note].join('\u0000');
    const hash = createHash('sha256').update(canonical).digest('hex');
    const id = entryId(hash);

    if (index.has(hash) && !process.env.FORCE) {
      const existing = index.get(hash);
      outcomes.push({ index: i, status: 'skipped', detail: `内容已存在（id ${existing?.id ?? id}）`, id });
      console.log(`跳过：内容已存在（id ${existing?.id ?? id}）`);
      continue;
    }

    const now = new Date().toISOString();
    const entry: Entry = {
      id,
      kind: 'text',
      date,
      createdAt: now,
      hash,
      likes: 0,
      note,
      contributor: { login, avatar: `https://github.com/${login}.png` },
      via: 'web',
      visible: true,
      processedAt: now,
      ...(title ? { title } : {}),
      ...(group ? { group } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(typeof job.issueNumber === 'number' ? { issueNumber: job.issueNumber } : {}),
    };

    if (opts.dryRun) {
      outcomes.push({ index: i, status: 'added', detail: '（dry-run，未写入）', id });
      console.log(`[dry-run] 会写入 ${id}：${title || note.slice(0, 24)}`);
      continue;
    }

    const result = await upsertEntry(opts.dataRoot, entry);
    index.set(hash, entry);
    outcomes.push({
      index: i,
      status: 'added',
      detail: `${toRepoPath(result.file)}（${result.replaced ? '覆盖已有' : '新增'}）`,
      id,
    });
    console.log(`新增 ${id} → ${toRepoPath(result.file)}  ${entry.date}`);
  }

  const added = outcomes.filter((item) => item.status === 'added');
  const skipped = outcomes.filter((item) => item.status === 'skipped');
  const failed = outcomes.filter((item) => item.status === 'failed');

  if (opts.report) {
    const report = {
      dryRun: opts.dryRun,
      totals: { added: added.length, skipped: skipped.length, failed: failed.length },
      added,
      skipped,
      failed,
    };
    await mkdir(path.dirname(opts.report), { recursive: true });
    await writeFile(opts.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`报告已写入 ${path.relative(REPO_ROOT, opts.report)}`);
  }

  console.log(`文字记录：新增 ${added.length}  跳过 ${skipped.length}  失败 ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`add-posts 出错：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
