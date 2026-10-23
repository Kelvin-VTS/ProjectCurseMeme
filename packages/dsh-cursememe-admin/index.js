import { createAdmin } from './lib/admin.mjs';
import { registerTools } from './lib/tools.mjs';

/**
 * DSH 插件入口。
 *
 * 只做三件事：加载配置、注册工具、把能力交给 DSH。
 * 不启动服务、不监听端口、不读微信数据库。
 */
export const name = 'dsh-cursememe-admin';
export const inject = ['tools'];

/**
 * @param {any} ctx
 * @param {{ configPath?: string }} [config]
 */
export function apply(ctx, config = {}) {
  const admin = createAdmin({
    configPath: config.configPath || undefined,
  });
  registerTools(ctx, admin);
}
