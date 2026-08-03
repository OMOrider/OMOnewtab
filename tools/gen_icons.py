# -*- coding: utf-8 -*-
"""生成插件图标 icon16/48/128.png：蓝色圆角方块 + 白色字母 N"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (24, 95, 165)          # #185FA5
FG = (255, 255, 255)
LETTER = "O"

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
]

def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

def main():
    for s in (16, 48, 128):
        img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        radius = max(3, int(s * 0.22))
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BG)
        f = load_font(int(s * 0.66))
        bbox = d.textbbox((0, 0), LETTER, font=f)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        x = (s - w) / 2 - bbox[0]
        y = (s - h) / 2 - bbox[1]
        d.text((x, y), LETTER, font=f, fill=FG)
        path = os.path.join(OUT, f"icon{s}.png")
        img.save(path)
        print("saved", path)

if __name__ == "__main__":
    main()
