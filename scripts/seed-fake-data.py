#!/usr/bin/env python
"""S2 阶段用的假数据种子脚本。

生成两样东西，保证两者永远一致：
  1. web/public/media/placeholder/*.webp   占位图（带真实宽高比）+ 一个演示用头像
  2. web/public/data/months/*.json         月份条目

注意：manifest.json 和 rankings.json **不在这里生成**，它们由派生脚本负责：
      python scripts/seed-fake-data.py && node scripts/build-index.mjs

这是开发期的脚手架。S3/S4 接入真实处理管线后，这堆 seed 数据会被替换掉。
"""

from __future__ import annotations

import hashlib
import json
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
MEDIA_DIR = ROOT / "web" / "public" / "media" / "placeholder"
DATA_DIR = ROOT / "web" / "public" / "data"
MONTH_DIR = DATA_DIR / "months"

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

# 每块占位图：id、宽、高、主色、比例标签
PLATES = [
    ("p01", 540, 960, (124, 58, 237), "9:16"),
    ("p02", 640, 640, (13, 148, 136), "1:1"),
    ("p03", 640, 480, (37, 99, 235), "4:3"),
    ("p04", 960, 540, (219, 39, 119), "16:9"),
    ("p05", 540, 720, (234, 88, 12), "3:4"),
    ("p06", 1200, 600, (147, 51, 234), "2:1"),
    ("p07", 540, 960, (8, 145, 178), "9:16"),
    ("p08", 640, 480, (101, 163, 13), "4:3"),
    ("p09", 600, 600, (79, 70, 229), "1:1"),
    ("p10", 960, 540, (22, 163, 74), "16:9"),
]

# 假条目：plate 决定尺寸，likes 用来验证榜单排序
SEEDS = [
    dict(id="a1b2c3d4e5f6", plate="p01", kind="video", date="2026-10-18", created="2026-10-18T22:41:00+08:00",
         title="半夜三点的群公告", group="G07", tags=["抽象"], duration=12, size=3_204_512, mime="video/mp4",
         login="friend-01", with_avatar=True, issue=12, likes=37, note="配乐比画面还阴间"),
    dict(id="b2c3d4e5f6a1", plate="p02", kind="image", date="2026-10-15", created="2026-10-15T19:02:00+08:00",
         title="同事的表情包生产线", group="个人投稿", tags=["搞笑"], size=486_233, mime="image/webp",
         login="friend-02", issue=11, likes=52),
    dict(id="c3d4e5f6a1b2", plate="p03", kind="image", date="2026-10-12", created="2026-10-12T09:15:00+08:00",
         group="G07", size=391_882, mime="image/webp", login="you", with_avatar=True, likes=8),
    dict(id="d4e5f6a1b2c3", plate="p04", kind="video", date="2026-10-09", created="2026-10-09T23:58:00+08:00",
         title="电梯里的 34 秒", group="G12", tags=["猎奇", "抽象"], duration=34, size=8_912_004, mime="video/mp4",
         login="friend-01", with_avatar=True, issue=10, likes=64, note="全程没人说话"),
    dict(id="e5f6a1b2c3d4", plate="p05", kind="image", date="2026-10-05", created="2026-10-05T14:20:00+08:00",
         group="个人投稿", tags=["猎奇"], size=612_004, mime="image/webp", login="friend-03", issue=9, likes=19),
    dict(id="f6a1b2c3d4e5", plate="p06", kind="image", date="2026-10-02", created="2026-10-02T08:03:00+08:00",
         title="横向长图：一张截图装下整个群", group="G07", tags=["抽象", "长图"], size=733_119, mime="image/webp",
         login="you", with_avatar=True, likes=41),
    dict(id="1a2b3c4d5e6f", plate="p07", kind="video", date="2026-09-27", created="2026-09-27T21:30:00+08:00",
         title="开学第一课", group="G12", tags=["抽象"], duration=8, size=1_802_331, mime="video/mp4",
         login="friend-02", issue=8, likes=88),
    dict(id="2b3c4d5e6f1a", plate="p08", kind="image", date="2026-09-20", created="2026-09-20T17:44:00+08:00",
         group="个人投稿", tags=["搞笑"], size=402_551, mime="image/webp", login="friend-03", issue=7, likes=12),
    dict(id="3c4d5e6f1a2b", plate="p09", kind="image", date="2026-09-14", created="2026-09-14T11:11:00+08:00",
         title="正方形的东西通常都不太对劲", group="G07", tags=["猎奇"], size=377_208, mime="image/webp",
         login="you", with_avatar=True, likes=45),
    dict(id="4d5e6f1a2b3c", plate="p10", kind="image", date="2026-09-03", created="2026-09-03T07:26:00+08:00",
         group="G12", tags=["抽象", "搞笑"], size=455_902, mime="image/webp", login="friend-01",
         with_avatar=True, issue=6, likes=73),
]

AVATAR_FILE = "avatar-demo.webp"


def load_font(size: int):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_plate(name: str, width: int, height: int, color: tuple[int, int, int], ratio: str) -> pathlib.Path:
    """生成一张有辨识度的占位图：竖向渐变 + 斜条纹 + 文字。"""
    image = Image.new("RGB", (width, height), (244, 244, 248))
    draw = ImageDraw.Draw(image)

    for y in range(height):
        t = y / max(1, height - 1)
        draw.line(
            [(0, y), (width, y)],
            fill=(
                int(color[0] * (1 - t) + 244 * t),
                int(color[1] * (1 - t) + 244 * t),
                int(color[2] * (1 - t) + 248 * t),
            ),
        )

    stripe = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    stripe_draw = ImageDraw.Draw(stripe)
    step = max(48, width // 8)
    for offset in range(-height, width + height, step):
        stripe_draw.line(
            [(offset, 0), (offset + height, height)],
            fill=(255, 255, 255, 26),
            width=max(6, step // 6),
        )
    image = Image.alpha_composite(image.convert("RGBA"), stripe).convert("RGB")
    draw = ImageDraw.Draw(image)

    unit = min(width, height)
    big = load_font(max(28, unit // 7))
    small = load_font(max(18, unit // 14))
    cx, cy = width // 2, height // 2

    draw.text((cx, cy - unit // 12), name, font=big, fill=(255, 255, 255), anchor="mm")
    draw.text((cx, cy + unit // 8), ratio, font=small, fill=(255, 255, 255), anchor="mm")
    draw.text((cx, cy + unit // 8 + unit // 14), f"{width}x{height}", font=small, fill=(250, 250, 255), anchor="mm")

    out = MEDIA_DIR / f"{name}.webp"
    image.save(out, "WEBP", quality=72, method=6)
    return out


def make_avatar_demo() -> pathlib.Path:
    """演示「contributor.avatar 有值」这条分支，避免依赖外网头像。"""
    size = 96
    image = Image.new("RGB", (size, size), (124, 58, 237))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / (size - 1)
        draw.line(
            [(0, y), (size, y)],
            fill=(int(124 + (139 - 124) * t), int(58 + (92 - 58) * t), int(237 + (246 - 237) * t)),
        )
    draw.ellipse((size * 0.28, size * 0.2, size * 0.72, size * 0.64), fill=(255, 255, 255))
    draw.ellipse((size * 0.12, size * 0.66, size * 0.88, size * 1.35), fill=(255, 255, 255))
    out = MEDIA_DIR / AVATAR_FILE
    image.save(out, "WEBP", quality=80, method=6)
    return out


def main() -> None:
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    MONTH_DIR.mkdir(parents=True, exist_ok=True)

    plates: dict[str, tuple[int, int, pathlib.Path]] = {}
    for name, width, height, color, ratio in PLATES:
        path = make_plate(name, width, height, color, ratio)
        plates[name] = (width, height, path)
    avatar = make_avatar_demo()
    print(f"  占位图 {len(plates)} 张 + 演示头像 -> {MEDIA_DIR.relative_to(ROOT)}")

    entries: list[dict] = []
    for seed in SEEDS:
        width, height, path = plates[seed["plate"]]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        is_video = seed["kind"] == "video"
        rel = f"media/placeholder/{seed['plate']}"

        contributor = {"login": seed["login"]}
        if seed.get("with_avatar"):
            contributor["avatar"] = f"media/placeholder/{AVATAR_FILE}"

        entry = {
            "id": seed["id"],
            "kind": seed["kind"],
            "date": seed["date"],
            "createdAt": seed["created"],
            "media": f"{rel}.mp4" if is_video else f"{rel}.webp",
            "poster": f"{rel}.webp",
            "thumb": f"{rel}.webp",
            "width": width,
            "height": height,
            "size": seed["size"],
            "mime": seed["mime"],
            "hash": digest,
            "likes": seed["likes"],
            "contributor": contributor,
            "via": "issue" if seed.get("issue") else "web",
            "visible": True,
        }
        for optional in ("title", "group", "note", "duration"):
            if seed.get(optional) is not None:
                entry[optional] = seed[optional]
        if seed.get("tags"):
            entry["tags"] = seed["tags"]
        if seed.get("issue"):
            entry["issueNumber"] = seed["issue"]

        entries.append(entry)

    entries.sort(key=lambda item: (item["date"], item["createdAt"]), reverse=True)

    by_month: dict[str, list[dict]] = {}
    for entry in entries:
        by_month.setdefault(entry["date"][:7], []).append(entry)

    for month, bucket in by_month.items():
        (MONTH_DIR / f"{month}.json").write_text(
            json.dumps({"month": month, "entries": bucket}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    print(f"  月份数据 {len(entries)} 条 -> {MONTH_DIR.relative_to(ROOT)} ({', '.join(sorted(by_month, reverse=True))})")
    print("\n  下一步：node scripts/build-index.mjs  （重建 manifest.json 与 rankings.json）")


if __name__ == "__main__":
    main()
