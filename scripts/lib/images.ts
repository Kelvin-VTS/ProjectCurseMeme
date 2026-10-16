import sharp from 'sharp';

export interface ImageMeta {
  width: number;
  height: number;
  format: string;
  /** EXIF 里的拍摄日期，格式 YYYY-MM-DD；读不到就是 null */
  exifDate: string | null;
  /** 是否带 EXIF（可能包含 GPS / 设备信息） */
  hasExif: boolean;
  /** 多帧图（动图 GIF / 动态 WebP） */
  animated: boolean;
}

/**
 * 从 EXIF 二进制里直接抠日期字符串，**不经过 Date 解析**。
 *
 * EXIF 的 DateTimeOriginal 在文件里就是 ASCII "2026:10:05 12:34:56"。
 * 交给日期库解析反而危险：EXIF 不带时区，一旦被当成 UTC，
 * 东八区就会渲染成前一天 —— 和 web/src/lib/date.ts 同一个坑。
 */
function exifDateFromBuffer(exif: Buffer): string | null {
  const text = exif.toString('latin1');
  const match = /(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}/.exec(text);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1990 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export async function readImageMeta(file: string): Promise<ImageMeta> {
  const meta = await sharp(file, { failOn: 'none' }).metadata();
  if (!meta.width || !meta.height) throw new Error(`读不到图片尺寸：${file}`);

  return {
    width: meta.width,
    height: meta.height,
    format: meta.format ?? 'unknown',
    exifDate: meta.exif ? exifDateFromBuffer(meta.exif) : null,
    hasExif: Boolean(meta.exif),
    animated: (meta.pages ?? 1) > 1,
  };
}

export interface WebpResult {
  width: number;
  height: number;
  bytes: number;
}

/**
 * 转 WebP。两个副作用都是我们要的：
 *   - rotate() 按 EXIF Orientation 把图摆正
 *   - 重编码天然丢掉全部 EXIF（GPS、设备型号、缩略图）
 */
export async function toWebp(
  input: string,
  output: string,
  maxEdge: number,
  quality: number,
): Promise<WebpResult> {
  const info = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toFile(output);

  return { width: info.width, height: info.height, bytes: info.size };
}

/**
 * 给视频候选帧打分，用来挑封面。
 * 对比度越高越好，过暗/过亮扣分 —— 纯黑首帧的 stdev 接近 0，必然垫底。
 */
export async function scoreFrame(file: string): Promise<number> {
  const stats = await sharp(file, { failOn: 'none' }).stats();
  const [red, green, blue] = stats.channels;
  if (!red || !green || !blue) return 0;

  const mean = 0.299 * red.mean + 0.587 * green.mean + 0.114 * blue.mean;
  const contrast = (red.stdev + green.stdev + blue.stdev) / 3;
  const distance = Math.abs(mean - 128) / 128; // 0 中间调，1 全黑或全白

  return contrast * (0.35 + 0.65 * (1 - distance));
}
