import { AdminError } from './errors.mjs';
import {
  assertDate,
  formatBytes,
  isAllowedExtension,
  makeBatchId,
  normalizeTags,
  safeName,
  todayLocal,
} from './util.mjs';

/**
 * 上传一批原始素材。
 *
 * 和网页端完全同一条路：只把原文件推到 `staging/<批次>`，转码、抽帧、查重、
 * 归月全部由 Actions 里的 process-media.ts 完成。插件不碰 ffmpeg。
 *
 * @param {{ config: any, client: any }} admin
 * @param {{ files: Array<{ name: string, bytes: Buffer, size: number }>, meta?: any, dryRun?: boolean }} options
 */
export async function uploadBatch(admin, { files, meta = {}, dryRun = false }) {
  const { config, client } = admin;

  if (!Array.isArray(files) || files.length === 0) {
    throw new AdminError('没有要上传的文件', { code: 'VALIDATION' });
  }
  if (files.length > config.maxFiles) {
    throw new AdminError(`一次最多上传 ${config.maxFiles} 个文件`, { code: 'VALIDATION' });
  }

  for (const file of files) {
    if (!file?.bytes || !file?.name) {
      throw new AdminError('文件对象缺少 name / bytes', { code: 'VALIDATION' });
    }
    if (file.size > config.maxFileBytes) {
      throw new AdminError(
        `文件太大：${file.name} 是 ${formatBytes(file.size)}，上限 ${formatBytes(config.maxFileBytes)}`,
        { code: 'FILE_TOO_LARGE' },
      );
    }
    if (!isAllowedExtension(file.name, config.allowedExtensions)) {
      throw new AdminError(
        `不支持的扩展名：${file.name}（只允许 ${config.allowedExtensions.join(' ')}）`,
        { code: 'VALIDATION' },
      );
    }
  }

  const date = meta.date ? assertDate(meta.date) : todayLocal();
  const tags = normalizeTags(meta.tags);
  const login = String(meta.login ?? '').trim() || config.defaultLogin;
  const batch = String(meta.batch ?? '').trim() || makeBatchId();
  const branch = `${config.stagingPrefix}${batch}`;

  /** @type {string[]} */
  const names = [];
  const used = new Set();
  for (let index = 0; index < files.length; index += 1) {
    let name = safeName(index, files[index].name);
    while (used.has(name)) name = `dup-${name}`;
    used.add(name);
    names.push(name);
  }

  const job = {
    version: 1,
    batch,
    login,
    createdAt: new Date().toISOString(),
    ...(date ? { date } : {}),
    ...(meta.group ? { group: String(meta.group).trim() } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    files: names,
  };

  const plannedFiles = files.map((file, index) => ({
    name: names[index],
    original: file.name,
    size: file.size,
  }));

  if (dryRun) {
    return {
      dryRun: true,
      branch,
      files: plannedFiles,
      job,
      note: 'dry-run：没有创建任何 blob、commit 或分支。',
    };
  }

  const baseSha = await client.getRef(config.defaultBranch);
  if (!baseSha) {
    throw new AdminError(`分支不存在：${config.defaultBranch}`, { code: 'NOT_FOUND' });
  }
  const baseCommit = await client.getCommit(baseSha);
  const baseTree = baseCommit?.tree?.sha;
  if (!baseTree) throw new AdminError('读不到 main 的 tree', { code: 'GITHUB' });

  /** @type {Array<{ path: string, mode: string, type: string, sha: string }>} */
  const entries = [];
  for (let index = 0; index < files.length; index += 1) {
    const blob = await client.createBlob(files[index].bytes.toString('base64'), 'base64');
    entries.push({
      path: `incoming/${names[index]}`,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }

  const jobBlob = await client.createBlob(JSON.stringify(job, null, 2), 'utf-8');
  entries.push({
    path: 'incoming/job.json',
    mode: '100644',
    type: 'blob',
    sha: jobBlob.sha,
  });

  const tree = await client.createTree(baseTree, entries);
  const commit = await client.createCommit({
    message: `bot: 上传 ${files.length} 个素材（${batch}）`,
    tree: tree.sha,
    parents: [baseSha],
    author: config.commitAuthor,
  });

  const actualBranch = await createBranchWithRetry(client, branch, commit.sha);

  return {
    dryRun: false,
    branch: actualBranch,
    commitSha: commit.sha,
    commitUrl: `https://github.com/${config.repo.owner}/${config.repo.name}/commit/${commit.sha}`,
    branchUrl: `https://github.com/${config.repo.owner}/${config.repo.name}/tree/${actualBranch}`,
    actionsUrl: `https://github.com/${config.repo.owner}/${config.repo.name}/actions`,
    files: plannedFiles,
    job,
    note: '已推到 staging 分支，Actions 正在处理（通常 1–2 分钟）；用 cursememe_run 查状态。',
  };
}

/**
 * 分支撞名时换一个后缀再试。批次号本身带随机盐，正常不会撞。
 *
 * @param {any} client
 * @param {string} branch
 * @param {string} sha
 */
async function createBranchWithRetry(client, branch, sha) {
  let candidate = branch;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await client.createRef(candidate, sha);
      return candidate;
    } catch (error) {
      if (error instanceof AdminError && error.status === 422) {
        candidate = `${branch}-${attempt + 2}`;
        continue;
      }
      throw error;
    }
  }
  throw new AdminError(`创建分支失败：${branch} 已存在`, { code: 'VALIDATION' });
}
