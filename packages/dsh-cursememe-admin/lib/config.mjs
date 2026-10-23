import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdminError } from './errors.mjs';

/**
 * 配置加载。
 *
 * 刻意不把 PAT / App 私钥写进插件代码或提示词：配置文件里只放**路径**，
 * 真正的密钥留在工作区之外。
 *
 * 配置文件默认在 `~/.dsh/secrets/cursememe-admin.json`；每次工具调用前按
 * mtime 重新读，改完 token 不需要重启 DSH。
 */

export const DEFAULT_REPO = Object.freeze({ owner: 'Kelvin-VTS', name: 'ProjectCurseMeme' });
export const DEFAULT_MEDIA_BASE = 'https://cdn.jsdelivr.net/gh/Kelvin-VTS/ProjectCurseMeme@main';
export const DEFAULT_SITE_BASE = 'https://kelvin-vts.github.io/ProjectCurseMeme';
export const DEFAULT_EXTENSIONS = Object.freeze([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
]);

/** @returns {string} */
export function defaultConfigPath() {
  return path.join(os.homedir(), '.dsh', 'secrets', 'cursememe-admin.json');
}

/**
 * @param {{ configPath?: string }} [options]
 */
export function createConfigLoader(options = {}) {
  const configPath = path.resolve(
    options.configPath || process.env.CURSEMEME_ADMIN_CONFIG || defaultConfigPath(),
  );

  /** @type {ReturnType<typeof normalizeConfig> | null} */
  let cached = null;
  let cachedStamp = 0;

  return {
    path: configPath,
    /**
     * @returns {ReturnType<typeof normalizeConfig>}
     */
    load() {
      let stamp;
      try {
        stamp = statSync(configPath).mtimeMs;
      } catch {
        throw new AdminError(`没有找到配置文件：${configPath}`, {
          code: 'CONFIG_MISSING',
          details: { configPath },
        });
      }

      if (cached && stamp === cachedStamp) return cached;

      let raw;
      try {
        raw = JSON.parse(readFileSync(configPath, 'utf8'));
      } catch (error) {
        throw new AdminError(`配置文件不是合法 JSON：${configPath}`, {
          code: 'CONFIG_INVALID',
          details: String(error),
        });
      }

      cached = normalizeConfig(raw, configPath);
      cachedStamp = stamp;
      return cached;
    },
  };
}

/**
 * @param {unknown} raw
 * @param {string} configPath
 */
function normalizeConfig(raw, configPath) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AdminError('配置文件顶层必须是一个 JSON 对象', { code: 'CONFIG_INVALID' });
  }

  const source = /** @type {Record<string, any>} */ (raw);
  const baseDir = path.dirname(configPath);
  const repoRaw = source.repo && typeof source.repo === 'object' ? source.repo : {};
  const repo = {
    owner: String(repoRaw.owner ?? DEFAULT_REPO.owner),
    name: String(repoRaw.name ?? DEFAULT_REPO.name),
  };
  if (!/^[\w.-]+$/.test(repo.owner) || !/^[\w.-]+$/.test(repo.name)) {
    throw new AdminError('repo.owner / repo.name 不合法', { code: 'CONFIG_INVALID' });
  }

  const authRaw = source.auth && typeof source.auth === 'object' ? source.auth : {};
  const mode = authRaw.mode === 'app' ? 'app' : authRaw.mode === 'pat' ? 'pat' : '';
  if (!mode) {
    throw new AdminError('auth.mode 必须是 "pat" 或 "app"', { code: 'CONFIG_INVALID' });
  }

  const resolvePath = (value) => (value ? path.resolve(baseDir, String(value)) : '');
  const auth = {
    mode,
    /** 仅用于临时调试；推荐用 patPath 或 CURSEMEME_PAT */
    pat: typeof authRaw.pat === 'string' ? authRaw.pat.trim() : '',
    patPath: resolvePath(authRaw.patPath),
    appId: authRaw.appId ? String(authRaw.appId) : '',
    installationId: authRaw.installationId ? String(authRaw.installationId) : '',
    privateKeyPath: resolvePath(authRaw.privateKeyPath),
  };

  if (mode === 'pat' && !auth.pat && !auth.patPath && !process.env.CURSEMEME_PAT) {
    throw new AdminError('auth.mode=pat 时需要 pat、patPath 或环境变量 CURSEMEME_PAT', {
      code: 'CONFIG_INVALID',
    });
  }
  if (mode === 'app' && (!auth.appId || !auth.installationId || !auth.privateKeyPath)) {
    throw new AdminError('auth.mode=app 时需要 appId、installationId、privateKeyPath', {
      code: 'CONFIG_INVALID',
    });
  }

  const extensions = Array.isArray(source.allowedExtensions)
    ? source.allowedExtensions
    : DEFAULT_EXTENSIONS;
  const allowedExtensions = extensions
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith('.') ? item : `.${item}`));

  const uploadRoots = Array.isArray(source.uploadRoots)
    ? source.uploadRoots
        .map((item) => String(item).trim())
        .filter(Boolean)
        .map((item) => path.resolve(baseDir, item))
    : [];

  const commitAuthorRaw =
    source.commitAuthor && typeof source.commitAuthor === 'object' ? source.commitAuthor : {};

  const stagingPrefix = String(source.stagingPrefix ?? 'staging/').replace(/^\/+/, '');
  const editPrefix = String(source.editPrefix ?? 'edit/').replace(/^\/+/, '');

  return {
    configPath,
    repo,
    defaultBranch: String(source.defaultBranch ?? 'main'),
    auth,
    uploadRoots,
    maxFiles: clampInt(source.maxFiles, 1, 50, 10),
    maxFileBytes: clampInt(source.maxFileBytes, 1024, 95 * 1024 * 1024, 80 * 1024 * 1024),
    allowedExtensions,
    cacheTtlMs: clampInt(source.cacheTtlMs, 0, 10 * 60_000, 60_000),
    timeoutMs: clampInt(source.timeoutMs, 1_000, 10 * 60_000, 60_000),
    mediaBase: String(source.mediaBase ?? DEFAULT_MEDIA_BASE).replace(/\/+$/, ''),
    siteBase: String(source.siteBase ?? DEFAULT_SITE_BASE).replace(/\/+$/, ''),
    defaultLogin: String(source.defaultLogin ?? 'cursememe-bot'),
    dryRun: source.dryRun === true,
    commitAuthor: {
      name: String(commitAuthorRaw.name ?? 'cursememe-bot'),
      email: String(commitAuthorRaw.email ?? 'cursememe-bot@users.noreply.github.com'),
    },
    stagingPrefix: stagingPrefix.endsWith('/') ? stagingPrefix : `${stagingPrefix}/`,
    editPrefix: editPrefix.endsWith('/') ? editPrefix : `${editPrefix}/`,
  };
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
