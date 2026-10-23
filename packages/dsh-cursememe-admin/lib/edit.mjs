import { AdminError } from './errors.mjs';
import { clamp, makeBatchId, normalizeTags } from './util.mjs';

const KNOWN_KEYS = new Set(['likes', 'title', 'tags', 'visible', 'login']);

/**
 * 把站长编辑台那套规则原样搬到 Node：点赞取整、标题清空就删、标签按中英文
 * 逗号拆分、可见性布尔。唯一的区别是这里会校验并抛错，而不是静默忽略。
 *
 * @param {any} entry
 * @param {Record<string, unknown>} patch
 * @returns {{ next: any, changedKeys: string[] }}
 */
export function applyPatch(entry, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new AdminError('patch 必须是对象', { code: 'VALIDATION' });
  }

  for (const key of Object.keys(patch)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new AdminError(`不支持的字段：${key}（只允许 ${[...KNOWN_KEYS].join(', ')}）`, {
        code: 'VALIDATION',
      });
    }
  }

  const next = JSON.parse(JSON.stringify(entry));
  /** @type {string[]} */
  const changedKeys = [];

  if (patch.likes !== undefined) {
    const likes = Number(patch.likes);
    if (!Number.isFinite(likes)) {
      throw new AdminError('likes 必须是数字', { code: 'VALIDATION' });
    }
    const value = clamp(Math.round(likes), 0, 1_000_000);
    if (value !== next.likes) {
      next.likes = value;
      changedKeys.push('likes');
    }
  }

  if (patch.title !== undefined) {
    if (typeof patch.title !== 'string') {
      throw new AdminError('title 必须是字符串', { code: 'VALIDATION' });
    }
    const title = patch.title.trim();
    if (title.length > 120) {
      throw new AdminError('title 太长（最多 120 字）', { code: 'VALIDATION' });
    }
    if (title) {
      if (next.title !== title) {
        next.title = title;
        changedKeys.push('title');
      }
    } else if (next.title !== undefined) {
      delete next.title;
      changedKeys.push('title');
    }
  }

  if (patch.tags !== undefined) {
    const tags = normalizeTags(patch.tags);
    const before = JSON.stringify(next.tags ?? []);
    const after = JSON.stringify(tags);
    if (before !== after) {
      if (tags.length > 0) next.tags = tags;
      else delete next.tags;
      changedKeys.push('tags');
    }
  }

  if (patch.visible !== undefined) {
    if (typeof patch.visible !== 'boolean') {
      throw new AdminError('visible 必须是布尔值', { code: 'VALIDATION' });
    }
    if (next.visible !== patch.visible) {
      next.visible = patch.visible;
      changedKeys.push('visible');
    }
  }

  if (patch.login !== undefined) {
    if (typeof patch.login !== 'string') {
      throw new AdminError('login 必须是字符串', { code: 'VALIDATION' });
    }
    const login = patch.login.trim();
    if (!login) {
      throw new AdminError('login 不能为空字符串；不想改就别传这个字段', { code: 'VALIDATION' });
    }
    if (login.length > 80) {
      throw new AdminError('login 太长（最多 80 字）', { code: 'VALIDATION' });
    }
    if (next.contributor?.login !== login) {
      next.contributor = { ...(next.contributor ?? {}), login };
      changedKeys.push('login');
    }
  }

  return { next, changedKeys };
}

/**
 * 修改一条已入库内容：读最新月份 JSON → 打补丁 → 推 `edit/<批次>`。
 * 索引和榜单由 edit-index.yml 重建，这里绝不手写 manifest / rankings。
 *
 * @param {{ config: any, client: any, data: any }} admin
 * @param {{ id: string, patch: Record<string, unknown>, dryRun?: boolean }} options
 */
export async function editEntry(admin, { id, patch, dryRun = false }) {
  const { config, client, data } = admin;
  const entryId = String(id ?? '').trim();
  if (!entryId) throw new AdminError('缺少条目 id', { code: 'VALIDATION' });

  const found = await data.getEntry(entryId);
  const { next, changedKeys } = applyPatch(found.entry, patch);

  if (changedKeys.length === 0) {
    return {
      changed: false,
      month: found.month,
      id: entryId,
      entry: found.entry,
      note: '这些值和现在一样，没有产生提交。',
    };
  }

  const entries = (found.file.entries ?? []).map((entry) =>
    entry.id === entryId ? next : entry,
  );
  const nextFile = { month: found.month, entries };
  const text = `${JSON.stringify(nextFile, null, 2)}\n`;
  const batch = makeBatchId();
  const branch = `${config.editPrefix}${batch}`;
  const filePath = `web/public/data/months/${found.month}.json`;

  if (dryRun) {
    return {
      dryRun: true,
      changed: true,
      month: found.month,
      id: entryId,
      path: filePath,
      changedKeys,
      before: found.entry,
      after: next,
      note: 'dry-run：没有创建 blob、commit 或分支。',
    };
  }

  const baseSha = await client.getRef(config.defaultBranch);
  if (!baseSha) throw new AdminError(`分支不存在：${config.defaultBranch}`, { code: 'NOT_FOUND' });
  const baseCommit = await client.getCommit(baseSha);
  const baseTree = baseCommit?.tree?.sha;
  if (!baseTree) throw new AdminError('读不到 main 的 tree', { code: 'GITHUB' });

  const blob = await client.createBlob(text, 'utf-8');
  const tree = await client.createTree(baseTree, [
    { path: filePath, mode: '100644', type: 'blob', sha: blob.sha },
  ]);
  const commit = await client.createCommit({
    message: `bot: 编辑 ${entryId}（${changedKeys.join(',')}）`,
    tree: tree.sha,
    parents: [baseSha],
    author: config.commitAuthor,
  });
  const actualBranch = await createBranchWithRetry(client, branch, commit.sha);

  return {
    dryRun: false,
    changed: true,
    month: found.month,
    id: entryId,
    path: filePath,
    changedKeys,
    before: found.entry,
    after: next,
    branch: actualBranch,
    commitSha: commit.sha,
    commitUrl: `https://github.com/${config.repo.owner}/${config.repo.name}/commit/${commit.sha}`,
    actionsUrl: `https://github.com/${config.repo.owner}/${config.repo.name}/actions`,
    note: '已推到 edit 分支，Actions 会重建 manifest/rankings 并重新部署；用 cursememe_run 查状态。',
  };
}

/**
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
