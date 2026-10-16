#!/usr/bin/env node
/**
 * CI 侧入库入口：处理 staging 分支带上来的**一批**素材。
 *
 * 为什么处理放在这里而不是浏览器：
 *   微信视频大量是 HEVC/H.265，浏览器不能转码，而 GitHub runner 自带 ffmpeg。
 *   所以浏览器只负责把原文件推到 staging/<批次> 分支，真正的处理在这个脚本里做，
 *   而且直接复用本地已经验证过的 scripts/process-media.ts —— 一套逻辑，两个入口。
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

async function main() {
  const jobRaw = await readFile(path.join(INCOMING, 'job.json'), 'utf8');
  const job = JSON.parse(jobRaw);

  const names = await readdir(INCOMING);
  const files = names.filter((name) => name !== 'job.json').sort();

  console.log(`批次      ${job.batch ?? '(未命名)'}`);
  console.log(`提交人    ${job.login ?? '未署名'}`);
  console.log(`文件数    ${files.length}`);
  if (files.length === 0) throw new Error('incoming/ 里没有任何素材文件');

  const mediaArgs = ['scripts/process-media.ts', '--login', String(job.login ?? 'unknown')];
  if (job.date) mediaArgs.push('--date', String(job.date));
  if (job.group) mediaArgs.push('--group', String(job.group));
  if (Array.isArray(job.tags) && job.tags.length > 0) {
    mediaArgs.push('--tags', job.tags.map(String).join(','));
  }
  // 本地演练时可以改指到临时目录，避免污染真实数据
  if (process.env.MEDIA_ROOT) mediaArgs.push('--media-root', process.env.MEDIA_ROOT);
  if (process.env.DATA_ROOT) mediaArgs.push('--data-root', process.env.DATA_ROOT);
  mediaArgs.push(INCOMING);

  const media = await step('处理媒体', mediaArgs);

  const indexArgs = ['scripts/build-index.mjs'];
  if (process.env.DATA_ROOT) indexArgs.push('--data-root', process.env.DATA_ROOT);
  const index = await step('重建索引与榜单', indexArgs);

  const tail = (text, lines) => text.trim().split('\n').slice(-lines).join('\n');

  const summary = [
    `## 上传入库：${job.batch ?? '(未命名批次)'}`,
    '',
    '| 项 | 值 |',
    '| --- | --- |',
    `| 提交人 | ${job.login ?? '未署名'} |`,
    `| 文件数 | ${files.length} |`,
    `| 日期 | ${job.date ?? '自动推断'} |`,
    `| 来源 | ${job.group ?? '（未填）'} |`,
    `| 标签 | ${Array.isArray(job.tags) && job.tags.length ? job.tags.join('、') : '（未填）'} |`,
    `| 媒体处理 | ${media.ok ? '全部成功' : '**有失败项**'} |`,
    `| 索引重建 | ${index.ok ? '成功' : '**失败**'} |`,
    '',
    '<details><summary>媒体处理日志（末尾 40 行）</summary>',
    '',
    '```',
    tail(media.output, 40),
    '```',
    '',
    '</details>',
    '',
  ].join('\n');

  console.log(`\n${summary}`);

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) await appendFile(summaryFile, `${summary}\n`, 'utf8');

  // 索引重建失败是硬错误：那样 main 上的 manifest 会跟月份数据对不上
  if (!index.ok) {
    console.error('索引重建失败，整批视为失败');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\ningest-batch 出错：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
