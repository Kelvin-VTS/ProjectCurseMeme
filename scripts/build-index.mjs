#!/usr/bin/env node
/**
 * 从 web/public/data/months/*.json 重建两个派生文件：
 *   - manifest.json   条目总数、总点赞、每月数量 / 封面 / 最新日期
 *   - rankings.json   本月榜 / 年度榜（按点赞数，同分按日期新的靠前）
 *
 * 单一数据源是「月份 JSON」，这个脚本只做派生，不修改条目本身。
 * 站长编辑台、seed 脚本、以及以后的 Actions 投稿流程都走这一条管线，
 * 保证只有一份榜单计算逻辑。
 *
 * 用法：node scripts/build-index.mjs
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 默认 web/public/data；带 --data-root 可以指向别处（测试或投稿流程用） */
const cliArgs = process.argv.slice(2);
const dataRootFlag = cliArgs.indexOf('--data-root');
const DATA_DIR = path.resolve(
  ROOT,
  dataRootFlag >= 0 && cliArgs[dataRootFlag + 1]
    ? cliArgs[dataRootFlag + 1]
    : path.join('web', 'public', 'data'),
);
const MONTH_DIR = path.join(DATA_DIR, 'months');

/** 每个榜单保留前几名 */
const TOP_N = 5;

/** 日期倒序；同日按入库时间倒序 —— 排序必须稳定，否则瀑布流顺序会跳 */
function byDateDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

/** 点赞倒序，同分按日期新的靠前 */
function byLikesDesc(a, b) {
  const diff = (b.likes ?? 0) - (a.likes ?? 0);
  if (diff !== 0) return diff;
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

function monthLabel(month) {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

function rankItem(entry, month) {
  const item = {
    id: entry.id,
    kind: entry.kind,
    date: entry.date,
    month,
    thumb: entry.thumb,
    width: entry.width,
    height: entry.height,
    likes: entry.likes ?? 0,
    contributor: entry.contributor,
  };
  if (entry.title) item.title = entry.title;
  return item;
}

/**
 * 搜索索引里的一条：渲染一张卡片所需的全部字段。
 * 刻意摊平成单个文件 —— /search 只拉这一个就能在前端过滤，
 * 否则得逐月拉取，月份一多请求数就线性上涨。
 */
function searchItem(entry, month) {
  const item = {
    id: entry.id,
    kind: entry.kind,
    date: entry.date,
    month,
    media: entry.media,
    poster: entry.poster,
    thumb: entry.thumb,
    width: entry.width,
    height: entry.height,
    likes: entry.likes ?? 0,
    contributor: entry.contributor,
  };
  if (entry.duration) item.duration = entry.duration;
  if (entry.group) item.group = entry.group;
  if (entry.tags?.length) item.tags = entry.tags;
  if (entry.title) item.title = entry.title;
  if (entry.note) item.note = entry.note;
  return item;
}

async function main() {
  const files = (await readdir(MONTH_DIR)).filter((name) => /^\d{4}-\d{2}\.json$/.test(name));
  if (files.length === 0) {
    console.error(`没有找到任何月份文件：${MONTH_DIR}`);
    process.exitCode = 1;
    return;
  }

  const months = [];
  for (const name of files) {
    const raw = await readFile(path.join(MONTH_DIR, name), 'utf8');
    const parsed = JSON.parse(raw);
    const month = parsed.month ?? name.slice(0, 7);
    // 软下架的条目不进索引、不进榜单
    const entries = (parsed.entries ?? []).filter((entry) => entry.visible !== false);
    months.push({ month, entries });
  }
  months.sort((a, b) => (a.month < b.month ? 1 : -1));

  const manifest = {
    version: 1,
    total: months.reduce((sum, m) => sum + m.entries.length, 0),
    totalLikes: months.reduce(
      (sum, m) => sum + m.entries.reduce((s, entry) => s + (entry.likes ?? 0), 0),
      0,
    ),
    months: months
      .filter((m) => m.entries.length > 0)
      .map((m) => {
        const newest = [...m.entries].sort(byDateDesc)[0];
        return {
          month: m.month,
          count: m.entries.length,
          cover: newest.thumb,
          latest: newest.date,
        };
      }),
  };

  const monthly = months
    .filter((m) => m.entries.length > 0)
    .map((m) => ({
      key: m.month,
      label: monthLabel(m.month),
      items: [...m.entries].sort(byLikesDesc).slice(0, TOP_N).map((entry) => rankItem(entry, m.month)),
    }));

  const byYear = new Map();
  for (const m of months) {
    const year = m.month.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    for (const entry of m.entries) byYear.get(year).push({ entry, month: m.month });
  }
  const yearly = [...byYear.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([year, list]) => ({
      key: year,
      label: `${year}年`,
      items: list
        .sort((x, z) => byLikesDesc(x.entry, z.entry))
        .slice(0, TOP_N)
        .map(({ entry, month }) => rankItem(entry, month)),
    }));

  const rankings = { version: 1, monthly, yearly };

  // 全站摊平的搜索索引，按日期倒序（搜索结果默认就是这个顺序）
  const search = {
    version: 1,
    total: manifest.total,
    entries: months.flatMap((m) =>
      [...m.entries].sort(byDateDesc).map((entry) => searchItem(entry, m.month)),
    ),
  };

  await writeFile(
    path.join(DATA_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(DATA_DIR, 'rankings.json'),
    `${JSON.stringify(rankings, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(DATA_DIR, 'search.json'),
    `${JSON.stringify(search)}\n`,
    'utf8',
  );

  console.log(`manifest.json  ${manifest.total} 条 / ${manifest.months.length} 个月份 / ${manifest.totalLikes} 赞`);
  for (const group of monthly) {
    const top = group.items[0];
    console.log(`  月榜 ${group.label}  首位点赞 ${top ? top.likes : 0}`);
  }
  for (const group of yearly) {
    const top = group.items[0];
    console.log(`  年榜 ${group.label}  首位点赞 ${top ? top.likes : 0}`);
  }
  console.log(`rankings.json  ${monthly.length} 个月榜 / ${yearly.length} 个年榜`);
  console.log(
    `search.json    ${search.entries.length} 条  ${(JSON.stringify(search).length / 1024).toFixed(1)} KB`,
  );
}

await main();
