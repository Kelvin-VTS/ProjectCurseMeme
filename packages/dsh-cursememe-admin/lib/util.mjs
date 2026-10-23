import path from 'node:path';
import { AdminError } from './errors.mjs';

/**
 * 纯工具函数。没有 I/O，方便单测。
 */

/**
 * 只保留安全字符，避免路径穿越和 git 不喜欢的东西。
 * 与 web/src/lib/github.ts 的 safeName 保持一致。
 *
 * @param {number} index
 * @param {string} original
 * @returns {string}
 */
export function safeName(index, original) {
  const name = String(original ?? '');
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, '') : '';
  const stem =
    (dot > 0 ? name.slice(0, dot) : name)
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'file';
  return `${String(index + 1).padStart(3, '0')}-${stem}${ext}`;
}

/**
 * `20261023-163000-ab12` 形状的批次号。用本地时间，和网页端一致。
 * @returns {string}
 */
export function makeBatchId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const salt = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${salt}`;
}

/** @returns {string} 本地日期 YYYY-MM-DD */
export function todayLocal() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * @param {unknown} value
 * @returns {string} 校验通过的 YYYY-MM-DD
 */
export function assertDate(value) {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new AdminError(`日期必须是 YYYY-MM-DD：${text}`, { code: 'VALIDATION' });
  }
  const [year, month, day] = text.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new AdminError(`日期不存在：${text}`, { code: 'VALIDATION' });
  }
  return text;
}

/**
 * @param {unknown} value
 * @returns {string} 校验通过的 YYYY-MM
 */
export function assertMonth(value) {
  const text = String(value ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    throw new AdminError(`月份必须是 YYYY-MM：${text}`, { code: 'VALIDATION' });
  }
  return text;
}

/**
 * 接受数组或逗号分隔字符串，去重、去空、限长。
 *
 * @param {unknown} value
 * @param {{ maxTags?: number, maxLength?: number }} [options]
 * @returns {string[]}
 */
export function normalizeTags(value, { maxTags = 8, maxLength = 24 } = {}) {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,，]/);
  const tags = [];
  for (const item of list) {
    const tag = String(item ?? '').trim();
    if (!tag) continue;
    if (tag.length > maxLength) {
      throw new AdminError(`标签太长（最多 ${maxLength} 字）：${tag}`, { code: 'VALIDATION' });
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > maxTags) {
    throw new AdminError(`标签太多（最多 ${maxTags} 个）`, { code: 'VALIDATION' });
  }
  return tags;
}

/**
 * @param {string} name
 * @param {readonly string[]} allowed
 * @returns {boolean}
 */
export function isAllowedExtension(name, allowed) {
  const ext = path.extname(String(name)).toLowerCase();
  return allowed.includes(ext);
}

/**
 * 判断 target 是否在 root 内（含 root 本身）。Windows 下大小写不敏感。
 *
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export function isInside(root, target) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const base = normalize(root);
  const candidate = normalize(target);
  return candidate === base || candidate.startsWith(`${base}${path.sep}`);
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
