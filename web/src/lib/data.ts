import type { Manifest, MonthFile, Rankings } from '../types';

/**
 * 数据与媒体地址解析。
 *
 * 关键点：站点可能部署在子路径下（GitHub Pages 项目站点是 /<repo>/），
 * 所以**任何运行时的相对地址都必须以 import.meta.env.BASE_URL 为基准**。
 * 写死 '/data' 这种以域名根为基准的路径，在项目站点上会请求到
 * https://<user>.github.io/data/... 而那里什么都没有，直接 404。
 *
 * 本地开发：BASE_URL = '/'            → /data、/media （dev 中间件服务仓库根 media/）
 * 线上：    BASE_URL = '/<repo>/'      → /<repo>/data；媒体另由 VITE_MEDIA_BASE 指向 CDN
 */
const BASE_URL = import.meta.env.BASE_URL;

const DATA_BASE = (import.meta.env.VITE_DATA_BASE ?? `${BASE_URL}data`).replace(/\/+$/, '');
const MEDIA_BASE = (import.meta.env.VITE_MEDIA_BASE ?? `${BASE_URL}media`).replace(/\/+$/, '');
const DATA_VERSION = import.meta.env.VITE_DATA_VERSION ?? '';

/** 把数据里的相对路径解析成可直接放进 src 的 URL；已经是 http(s) 的原样返回 */
export function mediaUrl(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${MEDIA_BASE}/${path.replace(/^\/+/, '')}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`加载失败 ${res.status} — ${url}`);
  return (await res.json()) as T;
}

function withVersion(url: string): string {
  return DATA_VERSION ? `${url}?v=${encodeURIComponent(DATA_VERSION)}` : url;
}

export function fetchManifest(): Promise<Manifest> {
  return getJson<Manifest>(withVersion(`${DATA_BASE}/manifest.json`));
}

export function fetchMonth(month: string): Promise<MonthFile> {
  return getJson<MonthFile>(withVersion(`${DATA_BASE}/months/${month}.json`));
}

export function fetchRankings(): Promise<Rankings> {
  return getJson<Rankings>(withVersion(`${DATA_BASE}/rankings.json`));
}
