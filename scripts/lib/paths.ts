import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录（scripts/lib/ 往上两级） */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 绝对路径 → 写进 JSON 的相对路径，统一用正斜杠 */
export function toRepoPath(absolute: string): string {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
}
