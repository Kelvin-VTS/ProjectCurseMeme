#!/usr/bin/env node
/**
 * scripts/ingest-issue.mjs 的测试。
 *
 * 解析 Issue 正文是 S4 里最容易悄悄出错的一块：GitHub 把视频附件渲染成什么形式、
 * 字段标题会不会带括号、日期写成 2026/10/21 还是 2026年10月21日 —— 全靠这里挡住。
 *
 * 用本地 HTTP 服务器冒充附件主机（配合 ATTACHMENT_HOSTS_EXTRA），
 * 所以不需要真的开 Issue 就能验证「下载 + 类型识别 + 落盘 + 写 job.json」整条链路。
 *
 * 运行：node scripts/test-ingest-issue.mjs
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.alloc(64, 3),
]);

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n        期望 ${JSON.stringify(expected)}\n        实际 ${JSON.stringify(actual)}`}`);
}

function checkTruthy(label, value) {
  const ok = Boolean(value);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
}

/** 跑一次 ingest-issue，返回 { status, stdout } */
async function runIngest(body, options = {}) {
  const work = await mkdtemp(path.join(tmpdir(), 'cursememe-issue-'));
  const incoming = path.join(work, 'incoming');
  const eventPath = path.join(work, 'event.json');

  await writeFile(
    eventPath,
    JSON.stringify({
      repository: { full_name: 'Kelvin-VTS/ProjectCurseMeme' },
      issue: {
        number: options.number ?? 42,
        title: options.title ?? '【投稿】测试',
        body,
        user: { login: options.login ?? 'some-friend' },
        pull_request: undefined,
      },
    }),
    'utf8',
  );

  const env = {
    ...process.env,
    GITHUB_EVENT_PATH: eventPath,
    INCOMING_DIR: incoming,
    WORK_DIR: work,
    ATTACHMENT_HOSTS_EXTRA: options.extraHosts ?? '',
    GITHUB_OUTPUT: path.join(work, 'output.txt'),
  };
  delete env.GITHUB_TOKEN;

  let stdout = '';
  try {
    const result = await run(process.execPath, [path.join(ROOT, 'scripts', 'ingest-issue.mjs')], {
      env,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (error) {
    stdout = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  const readIfExists = async (name) => {
    try {
      return await readFile(path.join(work, name), 'utf8');
    } catch {
      return null;
    }
  };

  return {
    work,
    stdout,
    status: (await readIfExists('stage-status'))?.trim() ?? '(无)',
    comment: await readIfExists('issue-comment.md'),
    prBody: await readIfExists('pr-body.md'),
    job: await readIfExists(path.join('incoming', 'job.json')),
    files: await readdir(incoming).catch(() => []),
    cleanup: () => rm(work, { recursive: true, force: true }),
  };
}

async function main() {
  // ---- 假附件服务器：三种 content-type，其中一种故意不声明类型来验 magic bytes 兜底
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/img')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    } else if (url.startsWith('/vid')) {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.end(MP4);
    } else if (url.startsWith('/mystery')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(PNG);
    } else if (url.startsWith('/boom')) {
      res.writeHead(404);
      res.end('nope');
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const extraHosts = `127.0.0.1:${server.address().port}`;
  console.log(`假附件服务器：${base}\n`);

  try {
    // ================= 场景 1：完整投稿，附件用三种不同写法 =================
    console.log('场景 1：完整投稿（裸链接 / markdown 图片 / HTML video 三种写法都要认出来）');
    const full = await runIngest(
      [
        '<!-- cursememe-submit -->',
        '',
        '### 日期',
        '',
        '2026/10/21',
        '',
        '### 来源 / 群名',
        '',
        'G07',
        '',
        '### 标签',
        '',
        '抽象, 搞笑、#长图',
        '',
        '### 一句说明',
        '',
        '半夜刷到的',
        '',
        '### 素材文件',
        '',
        `![截图](${base}/img)`,
        `<video src="${base}/vid" controls></video>`,
        '',
        `${base}/mystery`,
        '',
        '### 声明',
        '',
        '- [x] 我确认这些内容合法、不含违法或侵权内容，并同意在本站公开发布',
      ].join('\n'),
      { extraHosts, login: 'some-friend' },
    );

    check('状态为 ok', full.status, 'ok');
    check('落盘文件数（3 个附件 + job.json）', full.files.length, 4);
    check(
      '扩展名识别（含无 content-type 时靠 magic bytes 兜底）',
      full.files.filter((name) => name !== 'job.json').map((name) => path.extname(name)).sort(),
      ['.mp4', '.png', '.png'],
    );

    const job = full.job ? JSON.parse(full.job) : null;
    check('投稿人自动取自 Issue 作者', job?.login, 'some-friend');
    check('日期归一化 2026/10/21 → 2026-10-21', job?.date, '2026-10-21');
    check('来源带括号的标题也能匹配', job?.group, 'G07');
    check('标签按/顿号/逗号切分并去掉 #', job?.tags, ['抽象', '搞笑', '长图']);
    check('job.files 与实际文件一致', job?.files?.length, 3);
    checkTruthy('回评里有 PR 说明', full.comment?.includes('草稿 PR'));
    checkTruthy('PR 正文里有审核说明', full.prBody?.includes('合并即上线'));
    await full.cleanup();

    // ================= 场景 2：没勾声明 =================
    console.log('\n场景 2：声明没勾选 → 应拦下并要求勾选');
    const unchecked = await runIngest(
      ['<!-- cursememe-submit -->', '', '### 素材文件', '', `![a](${base}/img)`, '', '### 声明', '', '- [ ] 我确认'].join('\n'),
      { extraHosts },
    );
    check('状态为 unchecked', unchecked.status, 'unchecked');
    checkTruthy('回评提示去勾选声明', unchecked.comment?.includes('声明'));
    await unchecked.cleanup();

    // ================= 场景 3：没有附件 =================
    console.log('\n场景 3：有模板标记但没附件 → 应提示把文件拖进正文');
    const nothing = await runIngest(
      ['<!-- cursememe-submit -->', '', '### 日期', '', '2026-10-21', '', '### 声明', '', '- [x] 我确认'].join('\n'),
      { extraHosts },
    );
    check('状态为 nothing', nothing.status, 'nothing');
    checkTruthy('回评提示拖进正文而不是评论', nothing.comment?.includes('正文'));
    await nothing.cleanup();

    // ================= 场景 4：无关 Issue =================
    console.log('\n场景 4：与投稿无关的 Issue → 应静默跳过（不评论、不报错）');
    const unrelated = await runIngest('这是个 bug 报告，跟投稿无关。', { extraHosts });
    check('状态为 skip', unrelated.status, 'skip');
    check('不生成任何回评（避免骚扰无关 Issue）', unrelated.comment, null);
    await unrelated.cleanup();

    // ================= 场景 5：附件下载失败 =================
    console.log('\n场景 5：附件 404 → 应报下载失败并说明原因');
    const broken = await runIngest(
      ['<!-- cursememe-submit -->', '', '### 声明', '', '- [x] 我确认', '', '### 素材文件', '', `![x](${base}/boom)`].join('\n'),
      { extraHosts },
    );
    check('状态为 download-failed', broken.status, 'download-failed');
    checkTruthy('回评里带上了失败原因', broken.comment?.includes('HTTP 404'));
    await broken.cleanup();
  } finally {
    server.close();
  }

  console.log(`\n${failures === 0 ? '全部通过 ✅' : `${failures} 项失败 ❌`}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
