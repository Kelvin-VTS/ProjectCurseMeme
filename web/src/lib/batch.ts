/**
 * 批次标识与「今天」。
 *
 * 批次号进分支名：staging/<批次>，所以只允许字母数字和连字符。
 * 上传面板和文字编辑器共用，避免两边生成格式不一样的批次号。
 */
export function makeBatchId(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const salt = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${salt}`;
}

/** 本地日期的 YYYY-MM-DD */
export function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
