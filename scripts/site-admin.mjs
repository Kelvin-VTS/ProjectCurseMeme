#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createAdmin } from '../packages/dsh-cursememe-admin/lib/admin.mjs';
import { AdminError } from '../packages/dsh-cursememe-admin/lib/errors.mjs';
import { isAllowedExtension, normalizeTags } from '../packages/dsh-cursememe-admin/lib/util.mjs';

/**
 * 站长能力的本地入口。
 *
 * 和插件共用同一套 lib/；不经过微信，方便复现问题和做 smoke test。
 * 用法见 printUsage()。
 */

const BOOLEAN_FLAGS = new Set(['dry-run', 'include-hidden', 'help', 'json']);

const HELP = `用法: node scripts/site-admin.mjs <命令> [参数]

命令:
  auth                                    校验 token / App 与仓库权限
  overview [--month YYYY-MM]              站点总览
  search [--month] [--tag] [--login] [--keyword] [--limit N] [--include-hidden]
  entry <id>                              单条详情
  upload <file...> [--date YYYY-MM-DD] [--group] [--tags a,b] [--login] [--dry-run]
  edit <id> [--likes N] [--title 标题] [--tags a,b] [--visible true|false] [--login] [--dry-run]
  status <branch>                         查 Actions 运行状态

全局:
  --config <path>                         配置文件，默认 ~/.dsh/secrets/cursememe-admin.json
  --help                                  显示这段帮助

示例:
  node scripts/site-admin.mjs auth
  node scripts/site-admin.mjs search --tag 抽象 --limit 5
  node scripts/site-admin.mjs upload .cache\\bot-smoke.png --tags bot,smoke --group bot-test --dry-run
`;

try {
  await main();
} catch (error) {
  if (error instanceof AdminError) {
    console.error(`[${error.code}] ${error.message}`);
    if (error.details !== undefined) {
      console.error(JSON.stringify(error.details, null, 2));
    }
  } else {
    console.error(error?.stack ?? String(error));
  }
  process.exitCode = 1;
}

async function main() {
  const argv = process.argv.slice(2);
  const [command = 'help', ...rest] = argv;
  const { flags, positional } = parseArgs(rest);

  if (command === 'help' || command === '--help' || command === '-h' || flags.help) {
    console.log(HELP);
    return;
  }

  const admin = createAdmin({
    configPath: typeof flags.config === 'string' ? flags.config : undefined,
  });

  switch (command) {
    case 'auth': {
      print(await admin.authCheck());
      return;
    }
    case 'overview': {
      print(await admin.overview({ month: stringFlag(flags.month) }));
      return;
    }
    case 'search': {
      print(
        await admin.search({
          month: stringFlag(flags.month),
          tag: stringFlag(flags.tag),
          login: stringFlag(flags.login),
          keyword: stringFlag(flags.keyword),
          limit: flags.limit === undefined ? undefined : Number(flags.limit),
          includeHidden: isTrue(flags, 'include-hidden'),
        }),
      );
      return;
    }
    case 'entry': {
      const id = positional[0];
      if (!id) throw new AdminError('entry 需要条目 id', { code: 'VALIDATION' });
      print(await admin.getEntry(id));
      return;
    }
    case 'upload': {
      if (positional.length === 0) {
        throw new AdminError('upload 需要至少一个文件路径', { code: 'VALIDATION' });
      }
      const config = admin.config;
      const files = positional.map((input) => readUploadFile(input, config));
      const result = await admin.upload({
        files,
        meta: {
          date: stringFlag(flags.date),
          group: stringFlag(flags.group),
          tags: requireValue(flags.tags, 'tags'),
          login: stringFlag(flags.login),
        },
        dryRun: isTrue(flags, 'dry-run'),
      });
      print(result);
      return;
    }
    case 'edit': {
      const id = positional[0];
      if (!id) throw new AdminError('edit 需要条目 id', { code: 'VALIDATION' });
      /** @type {Record<string, unknown>} */
      const patch = {};
      if (flags.likes !== undefined) {
        const likes = Number(requireValue(flags.likes, 'likes'));
        if (!Number.isFinite(likes)) {
          throw new AdminError('--likes 需要数字', { code: 'VALIDATION' });
        }
        patch.likes = likes;
      }
      if (flags.title !== undefined) {
        const title = requireValue(flags.title, 'title');
        patch.title = title === '' ? '' : String(title);
      }
      if (flags.tags !== undefined) {
        patch.tags = normalizeTags(requireValue(flags.tags, 'tags'));
      }
      if (flags.visible !== undefined) {
        patch.visible = parseBool(requireValue(flags.visible, 'visible'));
      }
      if (flags.login !== undefined) {
        patch.login = String(requireValue(flags.login, 'login'));
      }
      if (Object.keys(patch).length === 0) {
        throw new AdminError('edit 至少要改一个字段', { code: 'VALIDATION' });
      }
      print(await admin.edit({ id, patch, dryRun: isTrue(flags, 'dry-run') }));
      return;
    }
    case 'status': {
      const branch = positional[0] ?? stringFlag(flags.branch);
      if (!branch) throw new AdminError('status 需要分支名', { code: 'VALIDATION' });
      print(await admin.runStatus(branch));
      return;
    }
    default: {
      throw new AdminError(`未知命令：${command}\n\n${HELP}`, { code: 'VALIDATION' });
    }
  }
}

/**
 * @param {string} input
 * @param {any} config
 */
function readUploadFile(input, config) {
  const absolute = path.resolve(input);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch (error) {
    throw new AdminError(`文件不存在或无法读取：${absolute}`, {
      code: 'FILE_NOT_FOUND',
      details: String(error),
    });
  }
  if (!stat.isFile()) throw new AdminError(`不是普通文件：${absolute}`, { code: 'VALIDATION' });
  if (stat.size > config.maxFileBytes) {
    throw new AdminError(`文件太大：${path.basename(absolute)}`, { code: 'FILE_TOO_LARGE' });
  }
  if (!isAllowedExtension(absolute, config.allowedExtensions)) {
    throw new AdminError(
      `不支持的扩展名：${path.basename(absolute)}（只允许 ${config.allowedExtensions.join(' ')}）`,
      { code: 'VALIDATION' },
    );
  }
  return {
    name: path.basename(absolute),
    bytes: fs.readFileSync(absolute),
    size: stat.size,
  };
}

/**
 * 极简参数解析：--key value / --key=value / --flag；其余进 positional。
 *
 * @param {string[]} tokens
 */
function parseArgs(tokens) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--') {
      positional.push(...tokens.slice(index + 1));
      break;
    }
    if (token.startsWith('--')) {
      const equal = token.indexOf('=');
      if (equal > 0) {
        flags[token.slice(2, equal)] = token.slice(equal + 1);
        continue;
      }
      const key = token.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = tokens[index + 1];
      if (next === undefined || (next.startsWith('--') && next !== '--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        index += 1;
      }
      continue;
    }
    positional.push(token);
  }

  return { flags, positional };
}

/** @param {Record<string, string | boolean>} flags @param {string} key */
function isTrue(flags, key) {
  const value = flags[key];
  return value === true || value === 'true' || value === '1';
}

/** @param {string | boolean | undefined} value */
function stringFlag(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** @param {string | boolean | undefined} value @param {string} name */
function requireValue(value, name) {
  if (value === undefined || value === true) {
    throw new AdminError(`--${name} 需要一个值`, { code: 'VALIDATION' });
  }
  return value;
}

/** @param {string | boolean} value */
function parseBool(value) {
  if (value === true) return true;
  const text = String(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  throw new AdminError(`需要 true/false：${value}`, { code: 'VALIDATION' });
}

/** @param {unknown} value */
function print(value) {
  console.log(JSON.stringify(value, null, 2));
}
