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
  /** 投稿指引里告诉访客怎么把素材交给站长。改这里就能换联系方式。 */
  contact: '在微信群里直接发给站长（记得附上日期和来源群）',
} as const;
