import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Entry, MonthFile } from '../../web/src/types.ts';
import { byDateDesc, monthOf } from '../../web/src/lib/date.ts';

export { monthOf };

/** 流式计算 sha256，避免把整个视频读进内存 */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return hash.digest('hex');
}

/** 取 hash 前 12 位当 id，同时也是文件名 —— 天然去重 */
export function entryId(hash: string): string {
  return hash.slice(0, 12);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function monthFilePath(dataRoot: string, month: string): string {
  return path.join(dataRoot, 'months', `${month}.json`);
}

/**
 * 扫描所有月份文件建立 hash → 条目 的索引。
 * 已下架（visible: false）的条目也算在内，否则会被重复导入。
 */
export async function loadHashIndex(dataRoot: string): Promise<Map<string, Entry>> {
  const index = new Map<string, Entry>();
  const dir = path.join(dataRoot, 'months');

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return index;
  }

  for (const name of names) {
    if (!/^\d{4}-\d{2}\.json$/.test(name)) continue;
    const file = await readJson<MonthFile | null>(path.join(dir, name), null);
    for (const entry of file?.entries ?? []) index.set(entry.hash, entry);
  }
  return index;
}

export interface UpsertResult {
  file: string;
  month: string;
  replaced: boolean;
}

/** 把条目并入对应月份文件：按 id 幂等，写完按日期倒序（与前端排序规则一致） */
export async function upsertEntry(dataRoot: string, entry: Entry): Promise<UpsertResult> {
  const month = monthOf(entry.date);
  const file = monthFilePath(dataRoot, month);
  const existing = await readJson<MonthFile>(file, { month, entries: [] });

  const entries = existing.entries.filter((item) => item.id !== entry.id);
  const replaced = entries.length !== existing.entries.length;
  entries.push(entry);
  entries.sort(byDateDesc);

  await writeJson(file, { month, entries });
  return { file, month, replaced };
}

export async function fileSize(file: string): Promise<number> {
  return (await stat(file)).size;
}
