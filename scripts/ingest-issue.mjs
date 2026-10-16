#!/usr/bin/env node
/**
 * S4：解析 GitHub Issue 投稿。
 *
 * 做三件事，全在 Node 里完成——**绝不把 Issue 内容拼进 shell**：
 *   1. 解析正文里的字段（`### 字段名` 分段）与附件链接
 *   2. 把附件下载到 incoming/，写好 job.json（投稿人 = Issue 作者）
 *   3. 生成回评内容，并把处理状态写进 $GITHUB_OUTPUT
 *
 * 之后由 workflow 调 ingest-batch.mjs 做转码与索引重建，
 * 再把产物推到一个 submit/issue-<n> 分支并开草稿 PR 等站长审核。
 *
 * 本地演练：GITHUB_EVENT_PATH=.cache/fake-event.json node scripts/ingest-issue.mjs
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EVENT_PATH = process.env.GITHUB_EVENT_PATH;
const TOKEN = process.env.GITHUB_TOKEN ?? '';
const INCOMING = path.resolve(process.env.INCOMING_DIR ?? 'incoming');
const WORK = path.resolve(process.env.WORK_DIR ?? '.cache');

const COMMENT_FILE = path.join(WORK, 'issue-comment.md');
const STATUS_FILE = path.join(WORK, 'stage-status');
const BODY_FILE = path.join(WORK, 'issue-body.md');

/** 单个附件上限。GitHub 的 100MB 是硬限，留点余量。 */
const MAX_BYTES = 90 * 1024 * 1024;

/** 模板里埋的标记：用来区分「投稿」和「随便开的 Issue」，避免对无关 Issue 乱评论 */
const MARKER = 'cursememe-submit';

const ATTACHMENT_PATTERNS = [
  'github.com/user-attachments/assets/',
  'github.com/user-attachments/files/',
  'user-images.githubusercontent.com/',
  'private-user-images.githubusercontent.com/',
  // 预留口子：GitHub 换域名时不用改代码；测试时也可以指到本地假服务器
  ...(process.env.ATTACHMENT_HOSTS_EXTRA ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
];

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

function log(...args) {
  console.log(...args);
}

/** `### 字段名` 分段 → Map */
function parseSections(body) {
  const sections = new Map();
  let current = null;
  let buffer = [];

  const flush = () => {
    if (current !== null) sections.set(current, buffer.join('\n').trim());
  };

  for (const line of body.split('\n')) {
    const heading = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      current = heading[1].trim();
      buffer = [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** 按前缀找字段，容忍「日期（YYYY-MM-DD）」这类带说明的标题 */
function pick(sections, ...keys) {
  const squash = (text) => text.replace(/[\s（）()：:]/g, '');
  for (const [label, value] of sections) {
    for (const key of keys) {
      if (squash(label).startsWith(squash(key))) return stripComments(value);
    }
  }
  return '';
}

/** 去掉模板里的 HTML 注释与空行 */
function stripComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

function normalizeDate(raw) {
  const match = /(20\d{2})\D{0,3}(\d{1,2})(?:\D{0,3}(\d{1,2}))?/.exec(raw ?? '');
  if (!match) return '';
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseTags(raw) {
  return (raw ?? '')
    .split(/[,，、\s]+/)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter((tag) => tag.length > 0 && tag.length <= 20)
    .slice(0, 8);
}

/**
 * 抽出所有附件链接。
 * 刻意**不对语法做假设**：裸链接、`![...](url)`、`[...](url)`、
 * `<video src="url">` 里的 URL 都能匹配到，这样不管 GitHub 把视频
 * 附件渲染成哪种形式都能识别。
 */
function extractAttachmentUrls(body) {
  const urls = new Set();
  for (const match of body.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
    const url = match[0].replace(/[.,;:]+$/, '');
    if (ATTACHMENT_PATTERNS.some((pattern) => url.includes(pattern))) urls.add(url);
  }
  return [...urls];
}

/** content-type 缺失时靠magic bytes 兜底，避免文件因为没有扩展名而被管线忽略 */
function sniffExtension(buffer) {
  const ascii = (start, end) => buffer.toString('latin1', start, end);
  if (buffer.length > 12 && ascii(4, 8) === 'ftyp') return '.mp4';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg';
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return '.png';
  if (ascii(0, 3) === 'GIF') return '.gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return '.webp';
  return '.bin';
}

async function download(url, index) {
  const headers = { 'User-Agent': 'cursememe-ingest' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) {
    throw new Error(`文件 ${(buffer.length / 1024 / 1024).toFixed(1)}MB 超过上限 ${MAX_BYTES / 1024 / 1024}MB`);
  }

  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = MIME_EXT[mime] ?? sniffExtension(buffer);
  const name = `${String(index + 1).padStart(2, '0')}-${randomUUID().slice(0, 8)}${ext}`;

  await writeFile(path.join(INCOMING, name), buffer);
  return { name, bytes: buffer.length, mime: mime || '(未声明)', ext };
}

/** 把结果写进 $GITHUB_OUTPUT，本地跑时退化成写文件 */
async function writeStatus(status, extra = {}) {
  await writeFile(STATUS_FILE, status, 'utf8');
  const outputFile = process.env.GITHUB_OUTPUT;
  const lines = [`status=${status}`, ...Object.entries(extra).map(([key, value]) => `${key}=${value}`)];
  if (outputFile) await appendFile(outputFile, `${lines.join('\n')}\n`, 'utf8');
  log(`\n处理状态：${status}`);
}

async function main() {
  if (!EVENT_PATH) throw new Error('缺少 GITHUB_EVENT_PATH');
  const payload = JSON.parse(await readFile(EVENT_PATH, 'utf8'));
  const issue = payload.issue;
  if (!issue) throw new Error('事件里没有 issue（这个 workflow 只该由 issues 事件触发）');

  const author = issue.user?.login ?? 'unknown';
  const body = issue.body ?? '';

  // 用户可控的内容一律落成文件再交给 shell —— 标题里带引号就能击穿 shell 拼接，
  // 所以 workflow 里绝不出现 ${{ github.event.issue.* }}。
  const safeAuthor = /^[A-Za-z0-9-]{1,39}$/.test(author) ? author : 'unknown';
  const safeTitle = String(issue.title ?? '').replace(/[\r\n]+/g, ' ').slice(0, 80);

  log(`Issue #${issue.number}  作者 @${safeAuthor}  标题「${safeTitle}」`);

  // 把原始正文留一份，解析出问题时能直接对着看
  await mkdir(WORK, { recursive: true });
  await writeFile(BODY_FILE, body, 'utf8');
  await writeFile(path.join(WORK, 'issue-title.txt'), safeTitle, 'utf8');
  await writeFile(path.join(WORK, 'issue-author.txt'), safeAuthor, 'utf8');

  // 模板标记用原始正文判断（标记本身就是 HTML 注释）；
  // 但**提取附件必须排除注释**：模板的说明文字是注释，访客很容易顺手把文件
  // 拖进注释块里——那不算投稿内容，而且被删掉后会留下 404 的死链接。
  const renderable = stripComments(body);
  const isSubmission = body.includes(MARKER) || extractAttachmentUrls(renderable).length > 0;
  if (!isSubmission) {
    log('这个 Issue 看不出是投稿（没有模板标记、也没有附件），静默跳过，不做任何评论。');
    await writeStatus('skip');
    return;
  }

  const sections = parseSections(body);
  const date = normalizeDate(pick(sections, '日期'));
  const group = pick(sections, '来源', '群名').split('\n')[0]?.trim() ?? '';
  const tags = parseTags(pick(sections, '标签'));
  const note = pick(sections, '说明', '备注');
  const declared = /^\s*[-*]\s*\[[xX]\]/m.test(pick(sections, '声明'));

  const urls = extractAttachmentUrls(renderable);
  log(`字段：日期=${date || '(自动推断)'}  来源=${group || '(空)'}  标签=${tags.join('/') || '(空)'}`);
  log(`附件：找到 ${urls.length} 个  声明已勾选=${declared}`);

  const summaryLines = [
    `### 投稿解析结果（Issue #${issue.number}）`,
    '',
    `- 作者：@${author}`,
    `- 日期：${date || '(未填，将由文件信息自动推断)'}`,
    `- 来源：${group || '(未填)'}`,
    `- 标签：${tags.join('、') || '(未填)'}`,
    `- 附件：${urls.length} 个`,
    `- 声明：${declared ? '已确认' : '**未勾选**'}`,
    '',
    '<details><summary>Issue 正文原文（排查解析问题用）</summary>',
    '',
    '```markdown',
    body.slice(0, 4000),
    '```',
    '',
    '</details>',
    '',
  ];
  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) await appendFile(stepSummary, `${summaryLines.join('\n')}\n`, 'utf8');

  if (urls.length === 0) {
    await writeFile(
      COMMENT_FILE,
      [
        '没有在正文里找到素材附件。',
        '',
        '请把图片 / 视频**直接拖进 Issue 正文**（不是拖到提交之后的评论里），然后编辑一下 Issue 保存即可，我会重新处理。',
        '',
        '如果确实是拖进正文的，麻烦把正文原样贴一段出来，方便排查。',
      ].join('\n'),
      'utf8',
    );
    await writeStatus('nothing');
    return;
  }

  if (!declared) {
    await writeFile(
      COMMENT_FILE,
      [
        '还差最后一步：请勾选正文最下方的**声明**（确认内容合法、同意公开发布），勾选后保存，我会自动重新处理。',
        '',
        `> 这条是为了合规：内容会公开在 ${'https://kelvin-vts.github.io/ProjectCurseMeme/'}，需要投稿人确认。`,
      ].join('\n'),
      'utf8',
    );
    await writeStatus('unchecked');
    return;
  }

  await mkdir(INCOMING, { recursive: true });

  const downloaded = [];
  const failed = [];
  for (let index = 0; index < urls.length; index += 1) {
    try {
      const info = await download(urls[index], index);
      downloaded.push(info);
      log(`  ✓ ${info.name}  ${(info.bytes / 1024).toFixed(0)} KB  ${info.mime}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ url: urls[index], reason });
      log(`  ✗ 下载失败：${reason}`);
    }
  }

  if (downloaded.length === 0) {
    await writeFile(
      COMMENT_FILE,
      ['附件下载全部失败，没法继续。', '', ...failed.map((item) => `- \`${item.reason}\``)].join('\n'),
      'utf8',
    );
    await writeStatus('download-failed');
    return;
  }

  const batch = `issue-${issue.number}-${Date.now().toString(36)}`;
  const job = {
    version: 1,
    batch,
    /** 投稿人由 Issue 作者自动记录，不需要访客手填 */
    login: safeAuthor,
    source: 'issue',
    issueNumber: issue.number,
    createdAt: new Date().toISOString(),
    ...(date ? { date } : {}),
    ...(group ? { group } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(note ? { note } : {}),
    files: downloaded.map((item) => item.name),
  };
  await writeFile(path.join(INCOMING, 'job.json'), `${JSON.stringify(job, null, 2)}\n`, 'utf8');

  await writeFile(
    COMMENT_FILE,
    [
      `收到 @${safeAuthor} 的投稿，正在处理 ${downloaded.length} 个文件。`,
      '',
      '| 项 | 值 |',
      '| --- | --- |',
      `| 日期 | ${date || '自动推断'} |`,
      `| 来源 | ${group || '（未填）'} |`,
      `| 标签 | ${tags.join('、') || '（未填）'} |`,
      `| 文件数 | ${downloaded.length}${failed.length > 0 ? `（${failed.length} 个下载失败）` : ''} |`,
      '',
      '处理包括：转码（HEVC → H.264）、抽帧选封面、生成缩略图、按日期归月。',
      '完成后会开一个**草稿 PR** 等站长审核合并——合并之后才会上线。',
    ].join('\n'),
    'utf8',
  );

  // PR 正文同样先落文件，workflow 再往里追加处理结果
  await writeFile(
    path.join(WORK, 'pr-body.md'),
    [
      `来自 #${issue.number} 的投稿，由 @${safeAuthor} 提交。`,
      '',
      '| 项 | 值 |',
      '| --- | --- |',
      `| 投稿人 | @${safeAuthor} |`,
      `| 日期 | ${date || '自动推断'} |`,
      `| 来源 | ${group || '（未填）'} |`,
      `| 标签 | ${tags.join('、') || '（未填）'} |`,
      `| 文件数 | ${downloaded.length} |`,
      `| 批次 | \`${batch}\` |`,
      '',
      '**审核说明**：合并即上线；直接关闭这个 PR 就相当于拒稿，素材不会进 `main`。',
      '',
      `原文：https://github.com/${payload.repository?.full_name ?? ''}/issues/${issue.number}`,
    ].join('\n'),
    'utf8',
  );

  await writeStatus('ok', { batch, author: safeAuthor, files: downloaded.length });
  log(`\n已落盘 ${downloaded.length} 个文件 + job.json（批次 ${batch}）`);
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\ningest-issue 出错：${message}`);
  try {
    await writeFile(COMMENT_FILE, `处理投稿时出错：\n\n\`\`\`\n${message}\n\`\`\``, 'utf8');
    await writeStatus('error');
  } catch {
    /* 连回评都写不出来的话就只剩退出码了 */
  }
  process.exitCode = 1;
});
