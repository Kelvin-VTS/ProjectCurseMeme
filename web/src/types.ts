/**
 * 站点级数据模型。
 * 这些结构和 web/public/data/*.json 里的内容一一对应，
 * 之后 scripts/process-media.ts 生成的 JSON 必须符合同一份契约。
 */

export type MediaKind = 'image' | 'video';

/**
 * 条目类型：图片、视频，以及**纯文字记录**（没有媒体文件，正文即内容）。
 */
export type EntryKind = MediaKind | 'text';

export interface Contributor {
  /** GitHub 登录名；seed 数据里是占位值 */
  login: string;
  /** 头像 URL；缺省时前端用首字母色块兜底 */
  avatar?: string;
}

export interface Entry {
  /** 内容 hash 前 12 位，同时用作文件名，天然去重 */
  id: string;
  kind: EntryKind;
  title?: string;
  /** 'YYYY-MM-DD'，本地日期，不做时区换算 */
  date: string;
  /** ISO 时间戳，入库时刻 */
  createdAt: string;

  /**
   * 以下媒体字段在 kind === 'text' 时全部缺省 ——
   * 纯文字条目没有文件，卡片会退化成一块文字。
   */
  /** 相对路径，如 'media/2026-10/ab12cd34ef56.mp4'；也可直接是 http(s) URL */
  media?: string;
  /** 首帧 / 缩略图相对路径 */
  poster?: string;
  /** 网格里实际使用的更小缩略图 */
  thumb?: string;

  /** 必存：瀑布流靠它做零抖动占位（文字条目没有） */
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  mime?: string;
  /** sha256，用于查重。文字条目也存，保证去重逻辑只有一套 */
  hash: string;

  /**
   * 点赞数。由站长维护（写在仓库 JSON 里）。
   * 访客自己的点亮记录只存在各自浏览器，不参与这个数字。
   */
  likes: number;

  group?: string;
  tags?: string[];
  /**
   * 正文，**Markdown**。
   *   媒体条目：图文说明（卡片下方摘要 + 详情页右侧）
   *   文字条目：全部内容
   * 纯文本本身就是合法 Markdown，所以历史数据不需要迁移。
   */
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
  /** 该月封面（相对路径）。整月只有文字记录时没有封面 */
  cover?: string;
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

/**
 * 搜索索引里的一条：全站条目摊平后的最小字段集。
 * 刻意不带 hash / size / mime / via 这类渲染用不到的字段——
 * 搜索结果是一次性全量拉取的，体积直接影响打开速度。
 */
export interface SearchEntry {
  id: string;
  kind: EntryKind;
  date: string;
  /** 'YYYY-MM'，用于按月份筛选 */
  month: string;
  media?: string;
  poster?: string;
  thumb?: string;
  width?: number;
  height?: number;
  duration?: number;
  likes: number;
  contributor: Contributor;
  group?: string;
  tags?: string[];
  title?: string;
  /** Markdown 正文（文字条目就是全部内容）；为了控制索引体积，入库时会截断 */
  note?: string;
}

/** search.json：由 scripts/build-index.mjs 生成，按日期倒序 */
export interface SearchIndex {
  version: number;
  total: number;
  entries: SearchEntry[];
}
