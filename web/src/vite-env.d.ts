/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 数据根路径，默认 '/data' */
  readonly VITE_DATA_BASE?: string;
  /** 媒体根路径（如 raw.githubusercontent.com/<user>/<repo>/main），默认 '' */
  readonly VITE_MEDIA_BASE?: string;
  /** 数据版本号 / 提交 SHA，用于绕开 raw 的 5 分钟 CDN 缓存 */
  readonly VITE_DATA_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
