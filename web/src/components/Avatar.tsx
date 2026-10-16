import { useState } from 'react';
import type { Contributor } from '../types';

const PALETTE = [
  '#7c3aed',
  '#0d9488',
  '#db2777',
  '#ea580c',
  '#2563eb',
  '#65a30d',
  '#9333ea',
  '#0891b2',
];

function paletteIndex(login: string): number {
  let hash = 0;
  for (let i = 0; i < login.length; i += 1) {
    hash = (hash * 31 + login.charCodeAt(i)) % 100000;
  }
  return hash % PALETTE.length;
}

/**
 * 上传者头像。
 *
 * 优先用 contributor.avatar（入库时由脚本填 https://github.com/<login>.png），
 * 拿不到或者加载失败就退化成「首字母 + 稳定配色」的色块，绝不显示破图。
 */
export function Avatar({
  contributor,
  size = 20,
}: {
  contributor: Contributor;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const login = contributor.login || '未知';
  const showImage = Boolean(contributor.avatar) && !failed;
  const initial = login.replace(/^@/, '').slice(0, 1).toUpperCase();
  const background = showImage ? 'transparent' : PALETTE[paletteIndex(login)];

  return (
    <span
      className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-black/5"
      style={{ width: size, height: size, backgroundColor: background }}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={contributor.avatar}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="font-semibold text-white" style={{ fontSize: Math.round(size * 0.5) }}>
          {initial}
        </span>
      )}
    </span>
  );
}
