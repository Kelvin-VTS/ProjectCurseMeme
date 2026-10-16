"""从 assets/brand/purpleicon.png 生成站点用的图标尺寸。

注意：purpleicon.png 的文件名是 .png，但内容其实是 JPEG（Pillow 报的 format 是 JPEG）。
Pillow 按内容嗅探，所以不影响；重新保存时才会写出真正的 PNG。
"""

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "brand" / "purpleicon.png"

# 顶栏 logo：由 Vite 打包，放 src/assets 走 import，路径和 base 由 Vite 处理
LOGO_DIR = ROOT / "web" / "src" / "assets"
# favicon / apple-touch-icon：放 public，用 %BASE_URL% 引用
PUBLIC_DIR = ROOT / "web" / "public"

LOGO_DIR.mkdir(parents=True, exist_ok=True)

image = Image.open(SOURCE).convert("RGB")
print(f"  源图 {SOURCE.relative_to(ROOT)}  {image.size}  {SOURCE.stat().st_size / 1024:.0f} KB")

# 顶栏 logo：128x128 足够（显示 32px，3 倍图）
logo = image.resize((128, 128), Image.LANCZOS)
logo_path = LOGO_DIR / "logo.webp"
logo.save(logo_path, "WEBP", quality=90, method=6)
print(f"  顶栏 logo  {logo_path.relative_to(ROOT)}  128x128  {logo_path.stat().st_size / 1024:.1f} KB")

# favicon / apple-touch-icon：192x192 PNG
icon = image.resize((192, 192), Image.LANCZOS)
icon_path = PUBLIC_DIR / "icon-192.png"
icon.save(icon_path, "PNG", optimize=True)
print(f"  站点图标   {icon_path.relative_to(ROOT)}  192x192  {icon_path.stat().st_size / 1024:.1f} KB")
