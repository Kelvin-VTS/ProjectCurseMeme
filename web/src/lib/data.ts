import type { Manifest, MonthFile, Rankings } from '../types';

/**
 * 数据与媒体地址解析。
 *
 * 本地开发：数据和占位媒体都在 web/public 下，走相对路径。
 * 线上（S3 之后）：
 *   VITE_DATA_BASE  = https://raw.githubusercontent.com/<user>/<repo>/main/web/public/data
 *   VITE_MEDIA_BASE = https://raw.githubusercontent.com/<user>/<repo>/main
 *   VITE_DATA_VERSION = 最新提交 SHA（绕开 raw 的 ~5 分钟 CDN 缓存）
 */
const DATA_BASE = (import.meta.env.VITE_DATA_BASE ?? '/data').replace(/\/+$/, '');
const MEDIA_BASE = (import.meta.env.VITE_MEDIA_BASE ?? '').replace(/\/+$/, '');
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
