/**
 * 站点级数据模型。
 * 这些结构和 web/public/data/*.json 里的内容一一对应，
 * 之后 scripts/process-media.ts 生成的 JSON 必须符合同一份契约。
 */

export type MediaKind = 'image' | 'video';

export interface Contributor {
  /** GitHub 登录名；seed 数据里是占位值 */
  login: string;
  /** 头像 URL；缺省时前端用首字母色块兜底 */
  avatar?: string;
}

export interface Entry {
  /** 内容 hash 前 12 位，同时用作文件名，天然去重 */
  id: string;
  kind: MediaKind;
  title?: string;
  /** 'YYYY-MM-DD'，本地日期，不做时区换算 */
  date: string;
  /** ISO 时间戳，入库时刻 */
  createdAt: string;

  /** 相对路径，如 'media/2026-10/ab12cd34ef56.mp4'；也可直接是 http(s) URL */
  media: string;
  /** 首帧 / 缩略图相对路径 */
  poster: string;
  /** 网格里实际使用的更小缩略图 */
  thumb: string;

  /** 必存：瀑布流靠它做零抖动占位 */
  width: number;
  height: number;
  duration?: number;
  size: number;
  mime: string;
  /** sha256，用于查重 */
  hash: string;

  /**
   * 点赞数。由站长维护（写在仓库 JSON 里）。
   * 访客自己的点亮记录只存在各自浏览器，不参与这个数字。
   */
  likes: number;

  group?: string;
  tags?: string[];
  note?: string;

  contributor: Contributor;
  via: 'web' | 'issue' | 'cli';
  issueNumber?: number;
  /** 下架开关（软删除）；false 的条目不会出现在站点和榜单里 */
  visible: boolean;
  processedAt?: string;
}

export interface MonthSummary {
  /** 'YYYY-MM' */
  month: string;
  count: number;
  /** 该月封面（相对路径） */
  cover: string;
  /** 该月最新条目日期 */
  latest: string;
}

export interface Manifest {
  version: number;
  total: number;
  /** 所有可见条目的点赞数之和 */
  totalLikes: number;
  months: MonthSummary[];
}

export interface MonthFile {
  month: string;
  entries: Entry[];
}

/** 榜单条目：为了排行榜文件尽量小，只带渲染需要的字段 */
export interface RankItem {
  id: string;
  kind: MediaKind;
  date: string;
  /** 该条所属月份，用于点击跳转 */
  month: string;
  title?: string;
  thumb: string;
  width: number;
  height: number;
  likes: number;
  contributor: Contributor;
}

export interface RankGroup {
  /** '2026-10' 或 '2026' */
  key: string;
  /** '2026年10月' 或 '2026年' */
  label: string;
  items: RankItem[];
}

export interface Rankings {
  version: number;
  /** 按月份倒序，每月的点赞榜 */
  monthly: RankGroup[];
  /** 按年份倒序，每年的点赞榜 */
  yearly: RankGroup[];
}
