#!/usr/bin/env node
/**
 * CI 侧入库入口：处理 staging 分支带上来的**一批**内容。
 *
 * 一批可能有两种东西，也可以同时有：
 *   1. 素材文件（incoming/ 下的图片 / 视频）→ process-media.ts 转码、抽帧、缩略图
 *   2. 文字记录（job.json 里的 posts）      → add-posts.ts 直接写成 kind:'text' 条目
 *
 * 为什么处理放在这里而不是浏览器：
 *   微信视频大量是 HEVC/H.265，浏览器不能转码，而 GitHub runner 自带 ffmpeg。
 *   所以浏览器只负责把原文件（或一段文字）推到 staging/<批次> 分支，
 *   真正的入库在这个脚本里做，复用本地已经验证过的管线 —— 一套逻辑，两个入口。
 *
 * 输入：incoming/job.json + incoming/ 下的原始文件
 * 输出：media/** 与 web/public/data/**（由 workflow 提交到 main）
 *
 * 本地演练（不污染真实数据）：
 *   MEDIA_ROOT=.cache/try/media DATA_ROOT=.cache/try/data node scripts/ingest-batch.mjs
 */

import { execFile } from 'node:child_process';
import { appendFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = process.cwd();
const INCOMING = process.env.INCOMING_DIR ?? 'incoming';
const WORK_DIR = process.env.WORK_DIR ?? '.cache';
const REPORT_PATH = path.join(WORK_DIR, 'ingest-report.json');
const POSTS_REPORT_PATH = path.join(WORK_DIR, 'posts-report.json');

/**
 * 跑一个子步骤，无论成败都把输出原样透出来。
 * 关键点：process-media 只要有**任一**文件失败就返回 1，
 * 但其余文件可能已经成功入库了，所以这里不能直接中断整批。
 */
async function step(title, args) {
  console.log(`\n=== ${title} ===`);
  try {
    const { stdout, stderr } = await run(process.execPath, args, {
      cwd: ROOT,
      maxBuffer: 128 * 1024 * 1024,
      windowsHide: true,
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    return { ok: true, output: stdout };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (output) process.stdout.write(output);
    console.error(`\n[${title}] 以退出码 ${error.code} 结束，继续走完剩下的步骤`);
    return { ok: false, output };
  }
}

async function readReport(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const jobRaw = await readFile(path.join(INCOMING, 'job.json'), 'utf8');
  const job = JSON.parse(jobRaw);
  const posts = Array.isArray(job.posts) ? job.posts : [];

  const names = await readdir(INCOMING);
  const files = names.filter((name) => name !== 'job.json').sort();

  console.log(`批次      ${job.batch ?? '(未命名)'}`);
  console.log(`提交人    ${job.login ?? '未署名'}`);
  console.log(`素材文件  ${files.length}`);
  console.log(`文字记录  ${posts.length}`);

  if (files.length === 0 && posts.length === 0) {
    throw new Error('incoming/ 里既没有素材文件，job.json 里也没有文字记录');
  }

  // ---------------- 1. 素材 ----------------
  let media = { ok: true, output: '（本批没有素材文件）' };
  if (files.length > 0) {
    const mediaArgs = ['scripts/process-media.ts', '--login', String(job.login ?? 'unknown')];
    if (job.date) mediaArgs.push('--date', String(job.date));
    if (job.group) mediaArgs.push('--group', String(job.group));
    if (Array.isArray(job.tags) && job.tags.length > 0) {
      mediaArgs.push('--tags', job.tags.map(String).join(','));
    }
    // 图文说明与标题：媒体条目同样可以带一段 Markdown 正文
    if (job.title) mediaArgs.push('--title', String(job.title));
    if (job.note) mediaArgs.push('--note', String(job.note));
    // 本地演练时可以改指到临时目录，避免污染真实数据
    if (process.env.MEDIA_ROOT) mediaArgs.push('--media-root', process.env.MEDIA_ROOT);
    if (process.env.DATA_ROOT) mediaArgs.push('--data-root', process.env.DATA_ROOT);
    mediaArgs.push('--report', REPORT_PATH);
    mediaArgs.push(INCOMING);

    media = await step('处理媒体', mediaArgs);
  }

  // ---------------- 2. 文字记录 ----------------
  let postsStep = { ok: true, output: '（本批没有文字记录）' };
  if (posts.length > 0) {
    const postArgs = ['scripts/add-posts.ts', '--incoming', INCOMING, '--report', POSTS_REPORT_PATH];
    if (process.env.DATA_ROOT) postArgs.push('--data-root', process.env.DATA_ROOT);
    postsStep = await step('写入文字记录', postArgs);
  }

  // ---------------- 3. 重建派生文件 ----------------
  const indexArgs = ['scripts/build-index.mjs'];
  if (process.env.DATA_ROOT) indexArgs.push('--data-root', process.env.DATA_ROOT);
  const index = await step('重建索引与榜单', indexArgs);

  const mediaReport = files.length > 0 ? await readReport(REPORT_PATH) : null;
  const postsReport = posts.length > 0 ? await readReport(POSTS_REPORT_PATH) : null;

  const totals = {
    added: (mediaReport?.totals?.added ?? 0) + (postsReport?.totals?.added ?? 0),
    skipped: (mediaReport?.totals?.skipped ?? 0) + (postsReport?.totals?.skipped ?? 0),
    failed: (mediaReport?.totals?.failed ?? 0) + (postsReport?.totals?.failed ?? 0),
  };

  const tail = (text, lines) => text.trim().split('\n').slice(-lines).join('\n');

  const summary = [
    `## 上传入库：${job.batch ?? '(未命名批次)'}`,
    '',
    '| 项 | 值 |',
    '| --- | --- |',
    `| 提交人 | ${job.login ?? '未署名'} |`,
    `| 素材文件 | ${files.length} |`,
    `| 文字记录 | ${posts.length} |`,
    `| 日期 | ${job.date ?? '自动推断'} |`,
    `| 来源 | ${job.group ?? '（未填）'} |`,
    `| 标签 | ${Array.isArray(job.tags) && job.tags.length ? job.tags.join('、') : '（未填）'} |`,
    `| 入库 | ${totals.added} |`,
    `| 跳过（已存在） | ${totals.skipped} |`,
    `| 失败 | ${totals.failed} |`,
    `| 索引重建 | ${index.ok ? '成功' : '**失败**'} |`,
    '',
    totals.added === 0 && totals.failed === 0
      ? '> 本批没有新增内容：这些内容此前已经入库过（按内容哈希查重），属于正常的空操作。'
      : '',
    '',
    '<details><summary>媒体处理日志（末尾 40 行）</summary>',
    '',
    '```',
    tail(media.output, 40),
    '```',
    '',
    '</details>',
    '',
    posts.length > 0
      ? [
          '<details><summary>文字记录处理日志</summary>',
          '',
          '```',
          tail(postsStep.output, 20),
          '```',
          '',
          '</details>',
          '',
        ].join('\n')
      : '',
  ].join('\n');

  console.log(`\n${summary}`);

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) await appendFile(summaryFile, `${summary}\n`, 'utf8');

  // ---------------- 4. 判定 ----------------
  // 索引重建失败是硬错误：那样 main 上的 manifest 会跟月份数据对不上
  if (!index.ok) {
    console.error('索引重建失败，整批视为失败');
    process.exitCode = 1;
    return;
  }
  if (files.length > 0 && !mediaReport) {
    console.error('拿不到媒体处理报告，无法判断结果，整批视为失败');
    process.exitCode = 1;
    return;
  }
  if (posts.length > 0 && !postsReport) {
    console.error('拿不到文字记录处理报告，无法判断结果，整批视为失败');
    process.exitCode = 1;
    return;
  }

  // 全是重复内容 = 正常的空操作，不该报红。这正是之前把用户坑住的那个判定。
  if (totals.added === 0 && totals.failed === 0 && totals.skipped > 0) {
    console.log(`本批 ${totals.skipped} 项此前已入库，没有新增内容（正常空操作）`);
    return;
  }

  if (totals.added === 0 && totals.failed > 0) {
    console.error(`本批 ${totals.failed} 项全部处理失败，没有任何内容入库`);
    process.exitCode = 1;
    return;
  }

  if (totals.failed > 0) {
    // 部分成功：成功的照常提交，失败的在 Actions 上以告警形式露出
    console.log(`::warning::本批有 ${totals.failed} 项处理失败，其余 ${totals.added} 项已入库`);
  }
}

main().catch((error) => {
  console.error(`\ningest-batch 出错：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
