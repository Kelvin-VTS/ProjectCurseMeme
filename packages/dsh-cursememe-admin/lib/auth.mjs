import { createSign } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { AdminError } from './errors.mjs';

const API = 'https://api.github.com';
const USER_AGENT = 'cursememe-admin';

/**
 * 两种机器身份：
 *
 * - `pat`：fine-grained PAT。网页端和本地调试都能用，最省事；
 * - `app`：GitHub App 的 installation token，1 小时过期，自动续期。
 *
 * 插件永远只把 token 留在进程里，不写进工具结果，也不让模型看见。
 *
 * @param {ReturnType<import('./config.mjs').createConfigLoader>['load'] extends () => infer T ? T : never} config
 */
export function createTokenProvider(config) {
  return config.auth.mode === 'app' ? createAppProvider(config) : createPatProvider(config);
}

/**
 * @param {any} config
 */
function createPatProvider(config) {
  /** @type {{ token: string, stamp: number }} */
  let cached = { token: '', stamp: 0 };

  return {
    kind: /** @type {const} */ ('pat'),
    async getToken() {
      const fromEnv = (process.env.CURSEMEME_PAT || '').trim();
      if (fromEnv) return fromEnv;
      if (config.auth.pat) return config.auth.pat;

      const file = config.auth.patPath;
      if (!file) {
        throw new AdminError('PAT 没有配置：请设置 auth.patPath 或环境变量 CURSEMEME_PAT', {
          code: 'AUTH_FAILED',
        });
      }

      try {
        const info = await stat(file);
        if (cached.token && cached.stamp === info.mtimeMs) return cached.token;
        const token = (await readFile(file, 'utf8')).trim();
        if (!token) throw new Error('文件是空的');
        cached = { token, stamp: info.mtimeMs };
        return token;
      } catch (error) {
        throw new AdminError(`读取 PAT 失败：${file}`, {
          code: 'AUTH_FAILED',
          details: String(error),
        });
      }
    },
    invalidate() {
      cached = { token: '', stamp: 0 };
    },
  };
}

/**
 * @param {any} config
 */
function createAppProvider(config) {
  /** @type {{ token: string, expiresAt: number } | null} */
  let cached = null;
  /** @type {Promise<string> | null} */
  let inflight = null;

  async function mint() {
    let privateKey;
    try {
      privateKey = await readFile(config.auth.privateKeyPath, 'utf8');
    } catch (error) {
      throw new AdminError(`读取 GitHub App 私钥失败：${config.auth.privateKeyPath}`, {
        code: 'AUTH_FAILED',
        details: String(error),
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.auth.appId }),
    );

    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    signer.end();
    const jwt = `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`;

    const data = await requestJson(
      `${API}/app/installations/${encodeURIComponent(config.auth.installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${jwt}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': USER_AGENT,
        },
      },
      'GitHub App 换取 installation token',
    );

    if (!data?.token || !data?.expires_at) {
      throw new AdminError('GitHub App 返回的 token 结构不完整', { code: 'AUTH_FAILED' });
    }

    cached = { token: data.token, expiresAt: Date.parse(data.expires_at) };
    return cached.token;
  }

  return {
    kind: /** @type {const} */ ('app'),
    async getToken() {
      if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
      if (!inflight) {
        inflight = mint().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
    invalidate() {
      cached = null;
    },
  };
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} label
 */
async function requestJson(url, init, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new AdminError(`${label}失败：网络错误`, {
      code: 'AUTH_FAILED',
      details: String(error),
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  /** @type {any} */
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof data === 'object' && data?.message
        ? data.message
        : typeof data === 'string'
          ? data.slice(0, 300)
          : '';
    throw new AdminError(`${label}失败：HTTP ${response.status}${message ? ` — ${message}` : ''}`, {
      code: 'AUTH_FAILED',
      status: response.status,
    });
  }

  return data;
}

/**
 * @param {string} value
 * @returns {string}
 */
function base64url(value) {
  return Buffer.from(value).toString('base64url');
}
