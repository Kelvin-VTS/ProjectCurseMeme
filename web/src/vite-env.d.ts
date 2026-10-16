/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 数据根路径，默认 `${BASE_URL}data`（部署到子路径时自动跟随） */
  readonly VITE_DATA_BASE?: string;
  /** 媒体根路径（如 https://cdn.jsdelivr.net/gh/<user>/<repo>@main），默认 `${BASE_URL}media` */
  readonly VITE_MEDIA_BASE?: string;
  /** 数据版本参数，用于绕开 CDN 缓存 */
  readonly VITE_DATA_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
