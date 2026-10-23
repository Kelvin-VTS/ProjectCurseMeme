import { AdminError } from './errors.mjs';

const API = 'https://api.github.com';
const USER_AGENT = 'cursememe-admin';

/**
 * GitHub REST 客户端。
 *
 * 只封装站长功能真正用到的那一小块：Git Data API（blob/tree/commit/ref）、
 * Contents 读取、Actions 运行状态。没有 GraphQL，也没有 octokit 依赖。
 */
export class GitHubClient {
  /**
   * @param {{ owner: string, repo: string, tokens: { getToken: () => Promise<string>, invalidate?: () => void }, timeoutMs?: number, userAgent?: string }} options
   */
  constructor({ owner, repo, tokens, timeoutMs = 60_000, userAgent = USER_AGENT }) {
    this.owner = owner;
    this.repo = repo;
    this.tokens = tokens;
    this.timeoutMs = timeoutMs;
    this.userAgent = userAgent;
    this.base = `/repos/${owner}/${repo}`;
  }

  /**
   * @param {string} method
   * @param {string} endpoint
   * @param {{ body?: unknown, auth?: boolean, retries?: number, accept?: string, headers?: Record<string, string> }} [options]
   * @returns {Promise<any>}
   */
  async request(method, endpoint, options = {}) {
    const {
      body,
      auth = true,
      retries = 3,
      accept = 'application/vnd.github+json',
      headers: extraHeaders = {},
    } = options;

    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${API}${path}`;
    let attempt = 0;

    for (;;) {
      /** @type {Record<string, string>} */
      const headers = {
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': this.userAgent,
        ...extraHeaders,
      };

      if (auth) {
        const token = await this.tokens.getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        if (attempt < retries) {
          await sleep(backoff(attempt));
          attempt += 1;
          continue;
        }
        throw new AdminError(`网络请求失败：${method} ${path}`, {
          code: 'NETWORK',
          details: String(error),
        });
      }
      clearTimeout(timer);

      // token 过期：让 provider 换一枚再试一次。App token 和 PAT 都走这里。
      if (response.status === 401 && auth && attempt === 0) {
        this.tokens.invalidate?.();
        attempt += 1;
        continue;
      }

      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : backoff(attempt));
        attempt += 1;
        continue;
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
          data && typeof data === 'object' && typeof data.message === 'string'
            ? data.message
            : typeof data === 'string'
              ? data.slice(0, 300)
              : '';
        const remaining = response.headers.get('x-ratelimit-remaining');
        const reset = response.headers.get('x-ratelimit-reset');
        const code =
          response.status === 401
            ? 'AUTH_FAILED'
            : response.status === 403 && remaining === '0'
              ? 'RATE_LIMIT'
              : response.status === 404
                ? 'NOT_FOUND'
                : response.status === 422
                  ? 'VALIDATION'
                  : 'GITHUB';

        throw new AdminError(
          `GitHub ${response.status}：${message || `${method} ${path}`}`,
          {
            code,
            status: response.status,
            details: {
              method,
              path,
              ...(reset ? { rateLimitReset: new Date(Number(reset) * 1000).toISOString() } : {}),
            },
          },
        );
      }

      return data;
    }
  }

  /** @param {string} branch */
  async getRef(branch) {
    try {
      const data = await this.request(
        'GET',
        `${this.base}/git/ref/heads/${encodeRef(branch)}`,
      );
      return data?.object?.sha ?? null;
    } catch (error) {
      if (error instanceof AdminError && error.status === 404) return null;
      throw error;
    }
  }

  /** @param {string} sha */
  getCommit(sha) {
    return this.request('GET', `${this.base}/git/commits/${sha}`);
  }

  /** @param {string} sha */
  getTree(sha) {
    return this.request('GET', `${this.base}/git/trees/${sha}`);
  }

  /**
   * @param {string} content
   * @param {'utf-8' | 'base64'} encoding
   */
  createBlob(content, encoding) {
    return this.request('POST', `${this.base}/git/blobs`, {
      body: { content, encoding },
    });
  }

  /**
   * @param {string} baseTree
   * @param {Array<{ path: string, mode: string, type: string, sha: string }>} tree
   */
  createTree(baseTree, tree) {
    return this.request('POST', `${this.base}/git/trees`, {
      body: { base_tree: baseTree, tree },
    });
  }

  /**
   * @param {{ message: string, tree: string, parents: string[], author?: { name: string, email: string } }} options
   */
  createCommit({ message, tree, parents, author }) {
    return this.request('POST', `${this.base}/git/commits`, {
      body: {
        message,
        tree,
        parents,
        ...(author ? { author, committer: author } : {}),
      },
    });
  }

  /**
   * @param {string} branch
   * @param {string} sha
   */
  createRef(branch, sha) {
    return this.request('POST', `${this.base}/git/refs`, {
      body: { ref: `refs/heads/${branch}`, sha },
    });
  }

  /**
   * 读仓库里的文本文件（manifest / 月份 JSON）。
   *
   * @param {string} filePath
   * @param {string} [ref]
   * @returns {Promise<{ text: string, sha: string, path: string }>}
   */
  async getFile(filePath, ref = 'main') {
    const data = await this.request(
      'GET',
      `${this.base}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`,
    );

    if (Array.isArray(data)) {
      throw new AdminError(`期望文件，但拿到目录：${filePath}`, { code: 'DATA_INVALID' });
    }

    let content = data?.content;
    if (data?.encoding === 'base64' && content) {
      content = Buffer.from(content, 'base64').toString('utf8');
    } else if (!content && data?.sha) {
      const blob = await this.request('GET', `${this.base}/git/blobs/${data.sha}`);
      content = Buffer.from(
        blob?.content ?? '',
        blob?.encoding === 'base64' ? 'base64' : 'utf8',
      ).toString('utf8');
    }

    return { text: String(content ?? ''), sha: String(data?.sha ?? ''), path: String(data?.path ?? filePath) };
  }

  /**
   * @param {string} dirPath
   * @param {string} [ref]
   * @returns {Promise<Array<{ name: string, path: string, type: string, sha: string }>>}
   */
  async listDir(dirPath, ref = 'main') {
    try {
      const data = await this.request(
        'GET',
        `${this.base}/contents/${encodePath(dirPath)}?ref=${encodeURIComponent(ref)}`,
      );
      return Array.isArray(data) ? data : [];
    } catch (error) {
      if (error instanceof AdminError && error.status === 404) return [];
      throw error;
    }
  }

  getRepo() {
    return this.request('GET', this.base);
  }

  /**
   * @param {string} branch
   * @param {{ auth?: boolean }} [options]
   */
  listRuns(branch, options = {}) {
    // 不把 branch 放进 query：带斜杠的分支名在部分 API 路径上会被过滤成空。
    // 拉最近 30 条，调用方按 head_branch 精确匹配。
    return this.request('GET', `${this.base}/actions/runs?per_page=30`, {
      auth: options.auth ?? false,
    });
  }
}

/**
 * 路径里每一段单独编码，保留 `/`。
 * @param {string} value
 */
function encodePath(value) {
  return String(value)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * ref 里的斜杠要保留；分支名本身可能带 `staging/`。
 * @param {string} branch
 */
function encodeRef(branch) {
  return String(branch)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** @param {number} attempt */
function backoff(attempt) {
  return Math.min(8_000, 500 * 2 ** attempt);
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
