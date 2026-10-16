import type { Entry } from '../types';

/**
 * 日期工具：全部走「字符串切片」，绝不经过 Date 解析。
 *
 * 原因：`new Date('2026-10-05')` 会被当成 UTC 午夜，在东八区渲染出来就是 10 月 4 日。
 * EXIF 的拍摄时间本身不带时区，所以整条链路都按「本地日期字符串」处理最安全。
 */

/** '2026-10' → '2026年10月' */
export function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-');
  if (!y || !m) return month;
  return `${y}年${Number(m)}月`;
}

/** '2026-10-05' → '2026年10月5日' */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return date;
  return `${y}年${Number(m)}月${Number(d)}日`;
}

/** '2026-10-05' → '10月5日' */
export function formatDateShort(date: string): string {
  const [, m, d] = date.split('-');
  if (!m || !d) return date;
  return `${Number(m)}月${Number(d)}日`;
}

/** 从日期串取归月键，非法输入回落到「未分类」 */
export function monthOf(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date ?? '');
  return m ? `${m[1]}-${m[2]}` : '0000-00';
}

/** 秒数 → 'm:ss' */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

/** 字节 → 人类可读 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** 月内排序：日期倒序，同日按入库时间倒序（排序必须稳定，否则瀑布流顺序会跳） */
export function byDateDesc(a: Entry, b: Entry): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

/** 校验 'YYYY-MM' 形状，非法月份直接不发请求 */
export function isValidMonth(month: string | undefined): month is string {
  return typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}
