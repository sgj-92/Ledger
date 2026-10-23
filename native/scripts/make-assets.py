"""Ledger's app icons and splash screens, for iOS and Android, from the web app's icon.

    python3 native/scripts/make-assets.py

Source: icon-512.png at the repository root (the PWA icon: the mark on its dark tile,
with the tile's rounded corners baked in on black). The rounded corners almost exactly
match iOS's own mask (radius ~22% of the side), so the tile is cropped to its edge and
the black corner wedges are filled with the tile's edge colour; each platform then
applies its own shape. A 1024px master would be sharper for the App Store — the 1024px
iOS icon here is upscaled from 512px (fine for development and TestFlight).
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.dirname(HERE)
ROOT = os.path.dirname(NATIVE)
BG = (14, 11, 8)                       # Ledger's dark ground, #0e0b08


def tile():
    """The icon tile, square and edge to edge, with no black corners."""
    im = Image.open(os.path.join(ROOT, 'icon-512.png')).convert('RGB')
    w, h = im.size

    def first(seq):
        return next(i for i, v in enumerate(seq) if v > 12)
    mid = w // 2
    left = first([sum(im.getpixel((x, mid))) for x in range(w)])
    right = w - first([sum(im.getpixel((x, mid))) for x in reversed(range(w))])
    top = first([sum(im.getpixel((mid, y))) for y in range(h)])
    bottom = h - first([sum(im.getpixel((mid, y))) for y in reversed(range(h))])
    side = min(right - left, bottom - top)
    t = im.crop((left, top, left + side, top + side))
    # the tile's corners were black: fill them with the colour just inside the edge
    px = t.load()
    edge = t.getpixel((side // 2, side - 6))
    for y in range(side):
        for x in range(side):
            if sum(px[x, y]) <= 24 and (min(x, side - 1 - x) < side * 0.25 and min(y, side - 1 - y) < side * 0.25):
                px[x, y] = edge
    return t


def save(img, *parts):
    path = os.path.join(NATIVE, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    return path


def rounded(img, radius_ratio=0.2237):
    """The tile with transparent rounded corners (for places that don't mask it)."""
    s = img.size[0]
    mask = Image.new('L', (s * 4, s * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s * 4 - 1, s * 4 - 1), radius=int(s * 4 * radius_ratio), fill=255)
    mask = mask.resize((s, s), Image.LANCZOS)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def circle(img):
    s = img.size[0]
    mask = Image.new('L', (s * 4, s * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, s * 4 - 1, s * 4 - 1), fill=255)
    mask = mask.resize((s, s), Image.LANCZOS)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def feathered(img, edge=0.10):
    """The tile fading out over its outer edge, to sit on a flat background of its colour."""
    s = img.size[0]
    f = max(1, int(s * edge))
    mask = Image.new('L', (s, s), 0)
    d = ImageDraw.Draw(mask)
    for i in range(f):
        d.rectangle((i, i, s - 1 - i, s - 1 - i), outline=int(255 * (i + 1) / f))
    d.rectangle((f, f, s - 1 - f, s - 1 - f), fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def splash(w, h, mark, mark_side):
    """Ledger's ground with the icon in the middle (the web app's splash colours)."""
    canvas = Image.new('RGB', (w, h), BG)
    m = rounded(mark.resize((mark_side, mark_side), Image.LANCZOS))
    canvas.paste(m, ((w - mark_side) // 2, (h - mark_side) // 2), m)
    return canvas


def main():
    t = tile()
    big = t.resize((1024, 1024), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))

    # ---- iOS ----
    ios = ('ios', 'App', 'App', 'Assets.xcassets')
    save(big, *ios, 'AppIcon.appiconset', 'AppIcon-512@2x.png')
    s = splash(2732, 2732, t, 420)
    for name in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
        save(s, *ios, 'Splash.imageset', name)

    # ---- Android ----
    res = ('android', 'app', 'src', 'main', 'res')
    dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
    for d, k in dens.items():
        legacy = int(48 * k)
        save(rounded(t.resize((legacy, legacy), Image.LANCZOS), 0.18), *res, 'mipmap-' + d, 'ic_launcher.png')
        save(circle(t.resize((legacy, legacy), Image.LANCZOS)), *res, 'mipmap-' + d, 'ic_launcher_round.png')
        # adaptive foreground (108dp): the tile at 76dp, its edges feathered into the
        # background layer (the tile's own edge colour), so the mark sits inside the 66dp
        # safe zone whatever shape the launcher cuts
        fg = int(108 * k)
        layer = Image.new('RGBA', (fg, fg), (0, 0, 0, 0))
        inner = int(76 * k)
        layer.paste(feathered(t.resize((inner, inner), Image.LANCZOS)), ((fg - inner) // 2, (fg - inner) // 2))
        save(layer, *res, 'mipmap-' + d, 'ic_launcher_foreground.png')
        # Android 12+ splash icon: 240dp, of which the middle 160dp circle shows
        si = int(240 * k)
        icon = Image.new('RGBA', (si, si), (0, 0, 0, 0))
        inner = int(150 * k)
        m = circle(t.resize((inner, inner), Image.LANCZOS))
        icon.paste(m, ((si - inner) // 2, (si - inner) // 2), m)
        save(icon, *res, 'drawable-' + d, 'splash_icon.png')
        # splash for Android 11 and earlier (portrait / landscape)
        pw, ph = int(320 * k), int(480 * k)
        save(splash(pw, ph, t, int(96 * k)), *res, 'drawable-port-' + d, 'splash.png')
        save(splash(ph, pw, t, int(96 * k)), *res, 'drawable-land-' + d, 'splash.png')
    save(splash(480, 320, t, 96), *res, 'drawable', 'splash.png')
    # the adaptive icon's background layer: the tile's edge colour
    edge = t.getpixel((t.size[0] // 2, t.size[0] - 6))
    with open(os.path.join(NATIVE, *res, 'values', 'ic_launcher_background.xml'), 'w') as fh:
        fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#%02X%02X%02X</color>\n</resources>\n' % edge[:3])
    # the offline page's mark (www/offline.html), rounded, at 3x its 56px
    save(rounded(t.resize((168, 168), Image.LANCZOS)), 'www', 'ledger-mark.png')
    print('icons and splash screens written')


if __name__ == '__main__':
    main()
