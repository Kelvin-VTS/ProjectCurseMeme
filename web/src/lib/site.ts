/** 站点配置 */
export const SITE = {
  name: '阴间素材库',
  tagline: '微信群里那些不能细看的东西',
  /**
   * 上传页要把素材推到哪个仓库。
   * 写死在这里而不是从 URL 推导：自定义域名下 URL 推导会失效，
   * 而且上传页需要一个明确的目标，宁可显式配置。
   */
  repo: { owner: 'Kelvin-VTS', name: 'ProjectCurseMeme' },
} as const;
