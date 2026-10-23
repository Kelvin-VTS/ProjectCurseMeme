import { AdminError } from './errors.mjs';
import { assertMonth, clamp } from './util.mjs';

const DATA_ROOT = 'web/public/data';

/**
 * 站点数据读取层。
 *
 * 唯一事实源是仓库里的 JSON；这里只做「取 + 缓存 + 过滤」。
 * 读最新数据走 GitHub Contents API（带 token），不用 jsDelivr 的 @main 缓存。
 */
export function createDataService({ config, client }) {
  /** @type {Map<string, { at: number, value: any }>} */
  const cache = new Map();
  /** @type {Map<string, { at: number, value: any }>} */
  const monthCache = new Map();

  /**
   * @param {string} filePath
   * @param {number} ttl
   */
  async function loadJson(filePath, ttl) {
    const now = Date.now();
    const hit = cache.get(filePath);
    if (hit && now - hit.at < ttl) return hit.value;

    const file = await client.getFile(filePath, config.defaultBranch);
    /** @type {any} */
    let value;
    try {
      value = JSON.parse(file.text);
    } catch (error) {
      throw new AdminError(`数据不是合法 JSON：${filePath}`, {
        code: 'DATA_INVALID',
        details: String(error),
      });
    }
    cache.set(filePath, { at: now, value });
    return value;
  }

  /**
   * @param {any} entry
   */
  function summary(entry) {
    const month = entry.month;
    return {
      id: entry.id,
      month,
      kind: entry.kind,
      date: entry.date,
      title: entry.title ?? '',
      tags: entry.tags ?? [],
      likes: entry.likes ?? 0,
      visible: entry.visible !== false,
      group: entry.group ?? '',
      contributor: entry.contributor?.login ?? '',
      thumbUrl: mediaUrl(entry.thumb),
      pageUrl: pageUrl(month),
      width: entry.width,
      height: entry.height,
    };
  }

  /**
   * @param {string} value
   */
  function mediaUrl(value) {
    const mediaPath = String(value ?? '');
    if (!mediaPath) return '';
    if (/^https?:\/\//i.test(mediaPath)) return mediaPath;
    return `${config.mediaBase}/${mediaPath.replace(/^\/+/, '')}`;
  }

  /**
   * @param {string} month
   */
  function pageUrl(month) {
    return month ? `${config.siteBase}/month/${month}` : config.siteBase;
  }

  return {
    /** @returns {Promise<any>} */
    manifest() {
      return loadJson(`${DATA_ROOT}/manifest.json`, config.cacheTtlMs);
    },

    /** @returns {Promise<any | null>} */
    async rankings() {
      try {
        return await loadJson(`${DATA_ROOT}/rankings.json`, config.cacheTtlMs);
      } catch (error) {
        if (error instanceof AdminError && error.status === 404) return null;
        throw error;
      }
    },

    /** @returns {Promise<any | null>} */
    async searchIndex() {
      try {
        return await loadJson(`${DATA_ROOT}/search.json`, config.cacheTtlMs);
      } catch (error) {
        if (error instanceof AdminError && error.status === 404) return null;
        throw error;
      }
    },

    /**
     * @param {string} month
     * @returns {Promise<any>}
     */
    async month(month) {
      const key = assertMonth(month);
      const now = Date.now();
      const hit = monthCache.get(key);
      if (hit && now - hit.at < config.cacheTtlMs) return hit.value;

      const value = await loadJson(`${DATA_ROOT}/months/${key}.json`, config.cacheTtlMs);
      monthCache.set(key, { at: now, value });
      return value;
    },

    /**
     * 摊平后的条目，每条额外带 `month`。
     * `includeHidden` 为 true 时逐月扫描（search.json 只含可见条目）。
     *
     * @param {boolean} includeHidden
     * @returns {Promise<Array<any>>}
     */
    async allEntries(includeHidden = false) {
      if (!includeHidden) {
        const index = await this.searchIndex();
        if (index?.entries?.length) {
          return index.entries.map((entry) => ({ ...entry, visible: true }));
        }
      }

      const manifest = await this.manifest();
      /** @type {Array<any>} */
      const entries = [];
      for (const item of manifest.months ?? []) {
        const file = await this.month(item.month);
        for (const entry of file.entries ?? []) {
          entries.push({ ...entry, month: item.month });
        }
      }
      return entries;
    },

    /**
     * @param {string} id
     * @returns {Promise<string>}
     */
    async findMonthForId(id) {
      const index = await this.searchIndex();
      const hit = index?.entries?.find((entry) => entry.id === id);
      if (hit?.month) return hit.month;

      const manifest = await this.manifest();
      for (const item of manifest.months ?? []) {
        const file = await this.month(item.month);
        if ((file.entries ?? []).some((entry) => entry.id === id)) return item.month;
      }

      throw new AdminError(`没有找到条目：${id}`, { code: 'NOT_FOUND' });
    },

    /**
     * @param {string} id
     * @returns {Promise<{ month: string, entry: any, file: any }>}
     */
    async getEntry(id) {
      const month = await this.findMonthForId(id);
      const file = await this.month(month);
      const entry = (file.entries ?? []).find((item) => item.id === id);
      if (!entry) throw new AdminError(`没有找到条目：${id}`, { code: 'NOT_FOUND' });
      return { month, entry, file };
    },

    /**
     * @param {{ month?: string, tag?: string, login?: string, keyword?: string, limit?: number, includeHidden?: boolean }} options
     */
    async search(options = {}) {
      const month = options.month ? assertMonth(options.month) : '';
      const tag = String(options.tag ?? '').trim();
      const login = String(options.login ?? '').trim().toLowerCase();
      const keyword = String(options.keyword ?? '').trim().toLowerCase();
      const limit = clamp(Number(options.limit) || 20, 1, 50);

      /** @type {Array<any>} */
      const all = await this.allEntries(Boolean(options.includeHidden));
      const filtered = all.filter((entry) => {
        if (month && entry.month !== month) return false;
        if (tag && !(entry.tags ?? []).includes(tag)) return false;
        if (login && String(entry.contributor?.login ?? '').toLowerCase() !== login) return false;
        if (keyword) {
          const haystack = [
            entry.title,
            entry.note,
            entry.id,
            entry.group,
            ...(entry.tags ?? []),
            entry.contributor?.login,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(keyword)) return false;
        }
        return true;
      });

      filtered.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });

      return {
        total: filtered.length,
        items: filtered.slice(0, limit).map((entry) => summary(entry)),
      };
    },

    /**
     * @param {{ month?: string }} [options]
     */
    async overview(options = {}) {
      const manifest = await this.manifest();
      const rankings = await this.rankings();
      const month = options.month
        ? assertMonth(options.month)
        : (manifest.months?.[0]?.month ?? '');

      const monthInfo = month
        ? ((manifest.months ?? []).find((item) => item.month === month) ?? null)
        : null;
      const group =
        (rankings?.monthly ?? []).find((item) => item.key === month) ??
        (rankings?.monthly ?? [])[0] ??
        null;

      return {
        total: manifest.total,
        totalLikes: manifest.totalLikes,
        months: (manifest.months ?? []).map((item) => ({
          month: item.month,
          count: item.count,
          latest: item.latest,
        })),
        month: monthInfo
          ? {
              month: monthInfo.month,
              count: monthInfo.count,
              latest: monthInfo.latest,
              top: (group?.items ?? []).slice(0, 5).map((item) => ({
                id: item.id,
                title: item.title ?? '',
                likes: item.likes,
                month: item.month,
                thumbUrl: mediaUrl(item.thumb),
                pageUrl: pageUrl(item.month),
              })),
            }
          : null,
      };
    },
  };
}
