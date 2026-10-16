import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { REPO_ROOT } from './paths.ts';

const execFileAsync = promisify(execFile);

const EXE = process.platform === 'win32' ? '.exe' : '';

export interface ToolPaths {
  ffmpeg: string;
  ffprobe: string;
}

/**
 * 按优先级找一个能用的二进制：
 *   1. FFMPEG_PATH / FFPROBE_PATH 环境变量
 *   2. 系统 PATH（GitHub Actions 的 ubuntu runner 自带，优先走这条）
 *   3. .cache/tools/（本地开发放静态二进制的地方，已 gitignore）
 *   4. node_modules/@ffmpeg-installer/<平台>-<架构>/
 */
function candidates(tool: 'ffmpeg' | 'ffprobe'): string[] {
  const list: string[] = [];
  const fromEnv = tool === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  if (fromEnv) list.push(fromEnv);

  list.push(tool);
  list.push(path.join(REPO_ROOT, '.cache', 'tools', `${tool}${EXE}`));
  list.push(
    path.join(
      REPO_ROOT,
      'node_modules',
      `@${tool}-installer`,
      `${process.platform}-${process.arch}`,
      `${tool}${EXE}`,
    ),
  );
  return list;
}

async function isUsable(binary: string): Promise<boolean> {
  try {
    await execFileAsync(binary, ['-version'], { timeout: 20000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

let cached: ToolPaths | null = null;

export async function resolveTools(): Promise<ToolPaths> {
  if (cached) return cached;

  const found: { ffmpeg?: string; ffprobe?: string } = {};
  for (const tool of ['ffmpeg', 'ffprobe'] as const) {
    for (const candidate of candidates(tool)) {
      // 含路径分隔符的候选先确认文件存在，避免无谓的 spawn
      if (candidate.includes(path.sep) && !existsSync(candidate)) continue;
      if (await isUsable(candidate)) {
        found[tool] = candidate;
        break;
      }
    }
  }

  if (!found.ffmpeg || !found.ffprobe) {
    const missing = [!found.ffmpeg && 'ffmpeg', !found.ffprobe && 'ffprobe'].filter(Boolean).join(' 与 ');
    throw new Error(
      `找不到可用的 ${missing}。三种解决方式：\n` +
        `  1. Windows 安装：winget install Gyan.FFmpeg（装完重开终端）\n` +
        `  2. 在仓库根目录执行 npm install（依赖里带了静态二进制，无需系统安装）\n` +
        `  3. 手动指定：FFMPEG_PATH=D:\\path\\ffmpeg.exe FFPROBE_PATH=D:\\path\\ffprobe.exe node scripts/process-media.ts`,
    );
  }

  cached = { ffmpeg: found.ffmpeg, ffprobe: found.ffprobe };
  return cached;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

interface FfprobeOutput {
  streams?: ProbeStream[];
  format?: { duration?: string; size?: string; tags?: Record<string, string> };
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  videoCodec: string;
  audioCodec: string | null;
  creationTime: string | null;
  bytes: number;
}

export async function probeVideo(file: string, tools: ToolPaths): Promise<VideoInfo> {
  const { stdout } = await execFileAsync(
    tools.ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
  const data = JSON.parse(stdout) as FfprobeOutput;
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video || !video.width || !video.height) throw new Error(`读不到视频流信息：${file}`);

  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(data.format?.duration ?? 0);

  return {
    width: video.width,
    height: video.height,
    duration: Number.isFinite(duration) ? duration : 0,
    videoCodec: String(video.codec_name ?? ''),
    audioCodec: audio ? String(audio.codec_name ?? '') : null,
    creationTime: data.format?.tags?.creation_time ?? null,
    bytes: Number(data.format?.size ?? 0),
  };
}

/** 浏览器能直接播的编码。HEVC/H.265 不在其中 —— 这正是微信视频最大的坑。 */
const BROWSER_VIDEO = new Set(['h264']);
const BROWSER_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis']);

export interface TranscodeDecision {
  needed: boolean;
  reason: string;
}

export function needsTranscode(info: VideoInfo, maxEdge: number): TranscodeDecision {
  const longEdge = Math.max(info.width, info.height);
  if (!BROWSER_VIDEO.has(info.videoCodec)) {
    return {
      needed: true,
      reason: `视频编码 ${info.videoCodec.toUpperCase() || '未知'} 浏览器不支持（HEVC/H.265 在 Chrome/Firefox 上是黑屏），转 H.264`,
    };
  }
  if (info.audioCodec && !BROWSER_AUDIO.has(info.audioCodec)) {
    return { needed: true, reason: `音频编码 ${info.audioCodec} 浏览器兼容性差，转 AAC` };
  }
  if (longEdge > maxEdge) {
    return { needed: true, reason: `长边 ${longEdge} 超过 ${maxEdge}，缩放` };
  }
  return {
    needed: false,
    reason: `已是 H.264${info.audioCodec ? `/${info.audioCodec}` : ''} 且 ${info.width}x${info.height}，只需无损重封装`,
  };
}

async function runFfmpeg(args: string[], tools: ToolPaths, label: string): Promise<void> {
  try {
    await execFileAsync(tools.ffmpeg, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '').trim();
    const tail = stderr.split('\n').slice(-6).join('\n');
    throw new Error(`${label} 失败：\n${tail || String(error)}`);
  }
}

export interface TranscodeOptions {
  /** 目标尺寸由调用方算好；不用滤镜表达式，避免转义踩坑和意外放大 */
  width: number;
  height: number;
  crf: number;
  preset: string;
}

/** 等比缩放到长边不超过 maxEdge（只缩不放），并保证是偶数（H.264 要求） */
export function fitSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width: even(width), height: even(height) };

  const scale = maxEdge / longEdge;
  return { width: even(width * scale), height: even(height * scale) };
}

export async function transcodeVideo(
  input: string,
  output: string,
  tools: ToolPaths,
  opts: TranscodeOptions,
): Promise<void> {
  await runFfmpeg(
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264',
      '-crf', String(opts.crf),
      '-preset', opts.preset,
      '-pix_fmt', 'yuv420p',
      '-vf', `scale=${opts.width}:${opts.height}`,
      '-c:a', 'aac', '-b:a', '128k',
      // 剥掉容器元数据（设备型号、原始路径、拍摄设备序列号等）
      '-map_metadata', '-1',
      // moov 前置，边下边播
      '-movflags', '+faststart',
      output,
    ],
    tools,
    `转码 ${path.basename(input)}`,
  );
}

/** 已经符合要求时无损重封装：只搬 moov，不重编码，秒级完成 */
export async function remuxVideo(input: string, output: string, tools: ToolPaths): Promise<void> {
  await runFfmpeg(
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-c', 'copy',
      '-map_metadata', '-1',
      '-movflags', '+faststart',
      output,
    ],
    tools,
    `重封装 ${path.basename(input)}`,
  );
}

export async function extractFrame(
  input: string,
  time: number,
  output: string,
  tools: ToolPaths,
  scaleWidth?: number,
): Promise<void> {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    // -ss 放在 -i 前面是快速定位
    '-ss', time.toFixed(3),
    '-i', input,
    '-frames:v', '1',
    '-q:v', '3',
  ];
  if (scaleWidth) args.push('-vf', `scale=${scaleWidth}:-2`);
  args.push(output);
  await runFfmpeg(args, tools, `抽帧 @${time.toFixed(1)}s`);
}

/** 抽帧时间点：避开首尾（很多视频开头淡入、结尾黑屏） */
export function posterTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0.5) return [0];
  const ratios = [0.1, 0.25, 0.45, 0.65, 0.85];
  const times = ratios.map((ratio) =>
    Number(Math.min(duration - 0.1, Math.max(0.05, duration * ratio)).toFixed(2)),
  );
  return [...new Set(times)];
}
