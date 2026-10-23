import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { AdminError } from './errors.mjs';
import { isAllowedExtension, isInside } from './util.mjs';

const MEDIA_EXT = /** @type {Record<string, string>} */ ({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
});

/**
 * 注册模型可见的工具。
 *
 * 安全边界写在两处：
 *   1. 工具参数里没有 repo / token / 任意路径的自由（repo 写死在配置里）；
 *   2. 上传文件必须是微信文件通道落盘的路径，或当前会话里的图片附件。
 *
 * @param {any} ctx
 * @param {ReturnType<import('./admin.mjs').createAdmin>} admin
 */
export function registerTools(ctx, admin) {
  ctx.tools.register(
    defineTool({
      name: 'cursememe_overview',
      description:
        '查看阴间素材库总览：总条数、总点赞、月份列表、指定月份（默认最新）的点赞前五。管理员问“站里现在有多少条 / 最近哪个月 / 榜首是谁”时用它。',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'YYYY-MM；不传则用最新月份' },
        },
        additionalProperties: false,
      },
      execute: (args) => admin.overview({ month: optionalString(args.month) }),
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'cursememe_search',
      description:
        '按月份、标签、上传者、关键词筛选已入库条目，返回 id、标题、点赞、缩略图链接。默认只搜可见条目；只有管理员明确要求看已下架的，才传 includeHidden=true。',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'YYYY-MM' },
          tag: { type: 'string', description: '标签，精确匹配' },
          login: { type: 'string', description: '上传者 GitHub 登录名' },
          keyword: { type: 'string', description: '在标题、备注、标签、id 里搜' },
          limit: { type: 'integer', description: '返回条数，1–50，默认 20' },
          includeHidden: { type: 'boolean', description: '是否包含 visible=false 的条目' },
        },
        additionalProperties: false,
      },
      execute: (args) =>
        admin.search({
          month: optionalString(args.month),
          tag: optionalString(args.tag),
          login: optionalString(args.login),
          keyword: optionalString(args.keyword),
          limit: Number.isInteger(args.limit) ? args.limit : undefined,
          includeHidden: args.includeHidden === true,
        }),
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'cursememe_entry',
      description:
        '按 id 取一条的完整信息（媒体路径、封面、尺寸、可见性、上传者）。改之前先看一眼，别凭印象改。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '条目 id，12 位十六进制' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      execute: (args) => requireId(args.id).then((id) => admin.getEntry(id)),
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'cursememe_upload',
      description:
        '把素材上传到站点。素材来源只有两种：微信文件通道落盘的路径（当前工作区 .wechatagent-files/incoming 下），或当前会话最近一条带图消息里的图片（attachment: "latest"）。只能由管理员在私聊里调用；不要上传用户没有明确要求上传的文件，也不要猜路径。上传会推到 staging 分支，由 Actions 转码、抽帧、查重后上线。',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: '微信文件通道落盘后的绝对/相对路径，最多 10 个',
          },
          attachment: {
            type: 'string',
            enum: ['latest', 'all'],
            description: '从当前会话最近一条带图消息取图片：latest 取最后一张，all 取该条全部',
          },
          date: { type: 'string', description: 'YYYY-MM-DD；不传则用今天' },
          group: { type: 'string', description: '来源群名或编号，可空' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签，最多 8 个',
          },
          login: { type: 'string', description: '上传者署名；不传用配置里的默认值' },
          dryRun: { type: 'boolean', description: '只校验和预览，不创建分支' },
        },
        additionalProperties: false,
      },
      execute: async (args, exec) => {
        const files = await collectUploadFiles(ctx, admin, args, exec);
        const dryRun = args.dryRun === undefined ? admin.config.dryRun : args.dryRun === true;
        return admin.upload({
          files,
          meta: {
            date: optionalString(args.date),
            group: optionalString(args.group),
            tags: args.tags,
            login: optionalString(args.login),
          },
          dryRun,
        });
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'cursememe_edit',
      description:
        '修改一条已入库内容：点赞、标题、标签、可见性、上传者。visible=false 就是软下架（条目留在仓库，不再出现在站点和榜单）。只改管理员明确要求的字段，一次只改一条。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '条目 id' },
          likes: { type: 'integer', description: '基准点赞数，0–1000000' },
          title: { type: 'string', description: '标题；传空字符串表示删除标题' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签数组；传空数组表示清空',
          },
          visible: { type: 'boolean', description: 'false = 软下架' },
          login: { type: 'string', description: '上传者 GitHub 登录名' },
          dryRun: { type: 'boolean', description: '只预览改动，不创建分支' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      execute: (args) => {
        const id = String(args.id ?? '').trim();
        if (!id) throw new AdminError('缺少条目 id', { code: 'VALIDATION' });

        /** @type {Record<string, unknown>} */
        const patch = {};
        for (const key of ['likes', 'title', 'tags', 'visible', 'login']) {
          if (args[key] !== undefined) patch[key] = args[key];
        }
        if (Object.keys(patch).length === 0) {
          throw new AdminError('至少要改一个字段（likes / title / tags / visible / login）', {
            code: 'VALIDATION',
          });
        }

        const dryRun = args.dryRun === undefined ? admin.config.dryRun : args.dryRun === true;
        return admin.edit({ id, patch, dryRun });
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'cursememe_run',
      description:
        '查 staging/edit 分支触发的 Actions 处理状态。上传或编辑后，管理员问“好了没 / 上线了吗”就用它。',
      parameters: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: '工具返回的 branch，如 staging/20261023-...' },
        },
        required: ['branch'],
        additionalProperties: false,
      },
      execute: (args) => {
        const branch = String(args.branch ?? '').trim();
        if (!branch) throw new AdminError('缺少分支名', { code: 'VALIDATION' });
        return admin.runStatus(branch);
      },
    }),
  );
}

/**
 * @param {{ name: string, description: string, parameters: any, execute: (args: any, exec: any) => any }} definition
 */
function defineTool(definition) {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    output: {
      schema: {},
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: definition.execute,
  };
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function optionalString(value) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
}

/**
 * @param {unknown} value
 * @returns {Promise<string>}
 */
async function requireId(value) {
  const id = String(value ?? '').trim();
  if (!id) throw new AdminError('缺少条目 id', { code: 'VALIDATION' });
  return id;
}

/**
 * 上传入口：路径或图片附件，二选一。
 *
 * @param {any} ctx
 * @param {any} admin
 * @param {any} args
 * @param {any} exec
 */
async function collectUploadFiles(ctx, admin, args, exec) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  const attachment = optionalString(args.attachment);

  if (paths.length > 0 && attachment) {
    throw new AdminError('paths 和 attachment 只能选一个', { code: 'VALIDATION' });
  }
  if (paths.length > 0) return resolvePathFiles(admin, paths, exec);
  if (attachment) return collectAttachmentFiles(ctx, admin, attachment, exec);

  throw new AdminError(
    '没有可上传的素材：传 paths（微信文件通道落盘的路径），或 attachment="latest"（当前会话最近一张图）',
    { code: 'VALIDATION' },
  );
}

/**
 * 只允许工作区 `.wechatagent-files/` 和配置里的 uploadRoots。
 * 这条规则是防“把 id_rsa 传到公开仓库”的最后一道闸。
 *
 * @param {any} admin
 * @param {string[]} rawPaths
 * @param {any} exec
 */
function resolvePathFiles(admin, rawPaths, exec) {
  const config = admin.config;
  if (rawPaths.length > config.maxFiles) {
    throw new AdminError(`一次最多上传 ${config.maxFiles} 个文件`, { code: 'VALIDATION' });
  }

  const cwd = exec?.agent?.session?.header?.cwd || process.cwd();
  const roots = [...config.uploadRoots, path.join(cwd, '.wechatagent-files')];

  return (async () => {
    const realRoots = await Promise.all(
      roots.map(async (root) => {
        try {
          return await realpath(root);
        } catch {
          return path.resolve(root);
        }
      }),
    );

    return Promise.all(
      rawPaths.map(async (raw) => {
        if (typeof raw !== 'string' || !raw.trim()) {
          throw new AdminError('paths 里有空值', { code: 'VALIDATION' });
        }

        const absolute = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
        /** @type {string} */
        let real;
        try {
          real = await realpath(absolute);
        } catch (error) {
          throw new AdminError(`文件不存在或无法读取：${absolute}`, {
            code: 'FILE_NOT_FOUND',
            details: String(error),
          });
        }

        if (!realRoots.some((root) => isInside(root, real))) {
          throw new AdminError(
            `拒绝上传微信收件目录之外的文件：${real}。请让管理员用文件方式发送，或先把素材放进工作区的 .wechatagent-files 下。`,
            { code: 'PATH_NOT_ALLOWED' },
          );
        }

        let info;
        try {
          info = await stat(real);
        } catch (error) {
          throw new AdminError(`读不到文件信息：${real}`, {
            code: 'FILE_NOT_FOUND',
            details: String(error),
          });
        }
        if (!info.isFile()) {
          throw new AdminError(`不是普通文件：${real}`, { code: 'VALIDATION' });
        }
        if (info.size > config.maxFileBytes) {
          throw new AdminError(`文件太大：${path.basename(real)} 超过单文件上限`, {
            code: 'FILE_TOO_LARGE',
          });
        }
        if (!isAllowedExtension(real, config.allowedExtensions)) {
          throw new AdminError(
            `不支持的扩展名：${path.basename(real)}（只允许 ${config.allowedExtensions.join(' ')}）`,
            { code: 'VALIDATION' },
          );
        }

        return {
          name: path.basename(real),
          bytes: await readFile(real),
          size: info.size,
        };
      }),
    );
  })();
}

/**
 * 从当前会话最近一条带图消息里取附件字节。
 *
 * @param {any} ctx
 * @param {any} admin
 * @param {string} mode
 * @param {any} exec
 */
async function collectAttachmentFiles(ctx, admin, mode, exec) {
  if (mode !== 'latest' && mode !== 'all') {
    throw new AdminError('attachment 只能是 latest 或 all', { code: 'VALIDATION' });
  }

  const session = exec?.agent?.session;
  if (!session) {
    throw new AdminError('当前调用不在会话里，取不到图片附件', { code: 'VALIDATION' });
  }

  const attachments = ctx.get('attachments');
  if (!attachments?.readImage) {
    throw new AdminError('当前 DSH 没有启用附件服务，读不到微信图片', { code: 'VALIDATION' });
  }

  const messages = session.surface?.deriveMessages?.() ?? [];
  /** @type {any[] | null} */
  let blocks = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    const images = (message.content ?? []).filter(
      (block) => block?.type === 'image' && block.attachment,
    );
    if (images.length > 0) {
      blocks = images;
      break;
    }
  }

  if (!blocks) {
    throw new AdminError(
      '当前会话里没有找到图片。让管理员直接发图（下一轮再让你传），或把图片以文件方式发送后传路径。',
      { code: 'NOT_FOUND' },
    );
  }

  const selected = mode === 'all' ? blocks : blocks.slice(-1);
  /** @type {Array<{ name: string, bytes: Buffer, size: number }>} */
  const files = [];

  for (const block of selected) {
    const ref = block.attachment;
    let stored;
    try {
      stored = await attachments.readImage(ref);
    } catch (error) {
      throw new AdminError('读取图片附件失败', { code: 'FILE_NOT_FOUND', details: String(error) });
    }

    const mediaType = stored?.ref?.mediaType ?? ref.mediaType;
    const extension = MEDIA_EXT[mediaType] ?? '.jpg';
    const rawName = typeof ref.name === 'string' ? ref.name.trim() : '';
    const base = rawName || `wechat-image-${String(ref.attachmentId).slice(0, 8)}`;
    const name = path.extname(base) ? base : `${base}${extension}`;
    const bytes = Buffer.from(stored.data);

    if (bytes.length > admin.config.maxFileBytes) {
      throw new AdminError(`图片太大：${name}`, { code: 'FILE_TOO_LARGE' });
    }

    files.push({ name, bytes, size: bytes.length });
  }

  return files;
}
