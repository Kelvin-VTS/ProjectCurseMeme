import { createConfigLoader } from './config.mjs';
import { createTokenProvider } from './auth.mjs';
import { GitHubClient } from './github.mjs';
import { createDataService } from './data.mjs';
import { uploadBatch } from './upload.mjs';
import { editEntry } from './edit.mjs';
import { runStatus } from './runs.mjs';

/**
 * 站长能力的门面：配置、身份、HTTP、数据、上传、编辑、运行状态。
 *
 * 配置按 mtime 热加载，所以改完 PAT / App 私钥路径不需要重启 DSH。
 *
 * @param {{ configPath?: string }} [options]
 */
export function createAdmin(options = {}) {
  const loader = createConfigLoader(options);
  /** @type {{ config: any, tokens: any, client: GitHubClient, data: any } | null} */
  let state = null;

  function resolve() {
    const config = loader.load();
    if (!state || state.config !== config) {
      const tokens = createTokenProvider(config);
      const client = new GitHubClient({
        owner: config.repo.owner,
        repo: config.repo.name,
        tokens,
        timeoutMs: config.timeoutMs,
      });
      state = {
        config,
        tokens,
        client,
        data: createDataService({ config, client }),
      };
    }
    return state;
  }

  return {
    get config() {
      return resolve().config;
    },
    get client() {
      return resolve().client;
    },
    get data() {
      return resolve().data;
    },
    get tokens() {
      return resolve().tokens;
    },

    /**
     * 校验身份和仓库权限。返回里不会出现 token。
     */
    async authCheck() {
      const { config, client, tokens } = resolve();
      const repo = await client.getRepo();
      /** @type {any} */
      const result = {
        auth: tokens.kind,
        repo: repo.full_name,
        private: Boolean(repo.private),
        defaultBranch: repo.default_branch,
        permissions: repo.permissions ?? null,
        canPush: Boolean(repo.permissions?.push),
      };

      // installation token 不能调 /user；PAT 可以，用来看当前登录名。
      if (tokens.kind === 'pat') {
        try {
          const user = await client.request('GET', '/user');
          result.login = user.login;
        } catch {
          // 权限受限的 PAT 可能读不到 /user，不影响仓库操作。
        }
      }

      return result;
    },

    /** @param {{ month?: string }} [options] */
    overview(options) {
      return resolve().data.overview(options);
    },

    /** @param {any} options */
    search(options) {
      return resolve().data.search(options);
    },

    /** @param {string} id */
    async getEntry(id) {
      const { month, entry } = await resolve().data.getEntry(id);
      // 只把这一条给模型；整月文件会白占上下文。
      return { month, entry };
    },

    /** @param {{ files: any[], meta?: any, dryRun?: boolean }} options */
    upload(options) {
      return uploadBatch(resolve(), options);
    },

    /** @param {{ id: string, patch: Record<string, unknown>, dryRun?: boolean }} options */
    edit(options) {
      return editEntry(resolve(), options);
    },

    /** @param {string} branch */
    runStatus(branch) {
      return runStatus(resolve(), branch);
    },
  };
}
