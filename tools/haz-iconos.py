#!/usr/bin/env python3
"""Genera los PNG del icono con Pillow, dibujando a 4x y reduciendo con
LANCZOS para que quede suave (el generador anterior pintaba rectángulos a
pelo, sin antialiasing, y se veía basto). Mismo motivo que icono.svg: ficha
de calificaciones — banda verde de cabecera, líneas regladas y un sello rojo,
sobre papel de ledger. Uso:  python3 tools/haz-iconos.py"""

import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAIZ = os.path.join(os.path.dirname(__file__), '..', 'app')
E = 4  # supersample

CREMA = (0xf8, 0xfa, 0xf0)
CREMA2 = (0xef, 0xf1, 0xe0)   # borde de la página, un pelín más oscuro
TINTA = (0x23, 0x2b, 0x1e)
VERDE = (0x2f, 0x4a, 0x34)
VERDE2 = (0x24, 0x3a, 0x29)  # sombra del verde, para el degradado de la banda
ROJO = (0xa5, 0x38, 0x2c)
ROJO2 = (0x7e, 0x29, 0x20)   # borde del sello, más oscuro
ORO = (0xa9, 0x76, 0x2f)
LINEA = (0x9a, 0x9f, 0x92)


def fuente(tam):
    for ruta in ('/System/Library/Fonts/Supplemental/Georgia Bold.ttf',
                 '/System/Library/Fonts/Supplemental/Georgia.ttf'):
        if os.path.exists(ruta):
            return ImageFont.truetype(ruta, tam)
    return ImageFont.load_default()


def degradado_vertical(size, c1, c2):
    img = Image.new('RGB', (1, size), c1)
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return img.resize((size, size))


def pinta(n_final):
    n = n_final * E
    img = degradado_vertical(n, CREMA, CREMA2)
    d = ImageDraw.Draw(img)

    # Banda verde de cabecera, con un degradado sutil propio (no plana).
    banda_h = round(190 / 512 * n)
    banda = degradado_vertical(banda_h, VERDE, VERDE2)
    img.paste(banda, (0, 0))
    d = ImageDraw.Draw(img)

    # Sombra suave bajo la banda (varias líneas semitransparentes) en vez de
    # un filete duro: así la banda parece recortada sobre el papel, no pegada.
    sombra = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    ds = ImageDraw.Draw(sombra)
    for i in range(round(14 * E)):
        alpha = int(70 * (1 - i / (14 * E)))
        ds.line([(0, banda_h + i), (n, banda_h + i)], fill=(0, 0, 0, alpha), width=1)
    img = Image.alpha_composite(img.convert('RGBA'), sombra).convert('RGB')
    d = ImageDraw.Draw(img)
    d.line([(0, banda_h), (n, banda_h)], fill=TINTA, width=round(3 * E))

    # Líneas regladas.
    for y512 in (258, 318, 378):
        y = round(y512 / 512 * n)
        x1 = n if y512 != 378 else round(320 / 512 * n)
        x0 = round(60 / 512 * n)
        d.line([(x0, y), (x1, y)], fill=LINEA, width=max(1, round(1.6 * E)))

    # Sello rojo: relleno con degradado radial (varios círculos concéntricos)
    # + anillo de tinta + anillo interior de papel, y una sombra suave debajo
    # para que se lea "estampado" en vez de pegado.
    cx, cy = round(390 / 512 * n), round(392 / 512 * n)
    r_ext = round(96 / 512 * n)

    sombra2 = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    ds2 = ImageDraw.Draw(sombra2)
    off = round(6 * E)
    ds2.ellipse([cx - r_ext + off, cy - r_ext + off, cx + r_ext + off, cy + r_ext + off], fill=(0, 0, 0, 90))
    sombra2 = sombra2.filter(ImageFilter.GaussianBlur(radius=8 * E // 4))
    img = Image.alpha_composite(img.convert('RGBA'), sombra2).convert('RGB')
    d = ImageDraw.Draw(img)

    pasos = 40
    for i in range(pasos, -1, -1):
        t = i / pasos
        r = round(r_ext * t)
        col = tuple(round(ROJO2[k] + (ROJO[k] - ROJO2[k]) * (1 - t)) for k in range(3))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    d.ellipse([cx - r_ext, cy - r_ext, cx + r_ext, cy + r_ext], outline=TINTA, width=round(10 / 512 * n))
    r_in_out, r_in_in = round(65 / 512 * n), round(59 / 512 * n)
    ring = (r_in_out + r_in_in) // 2
    d.ellipse([cx - ring, cy - ring, cx + ring, cy + ring], outline=CREMA, width=r_in_out - r_in_in)

    # Insignia dorada girada junto a la banda — el mismo motivo de ".marca i"
    # del proyecto (un cuadrado dorado a -6°, como un sello propio).
    lado = round(46 / 512 * n)
    badge = Image.new('RGBA', (lado * 3, lado * 3), (0, 0, 0, 0))
    db = ImageDraw.Draw(badge)
    db.rectangle([lado, lado, lado * 2, lado * 2], fill=ORO)
    badge = badge.rotate(-6, resample=Image.BICUBIC, expand=False)
    bx, by = round(64 / 512 * n), round(64 / 512 * n)
    img.paste(badge, (bx - lado, by - lado), badge)

    return img.resize((n_final, n_final), Image.LANCZOS)


for n, nombre in [(180, 'icono-180.png'), (192, 'icono-192.png'), (512, 'icono-512.png')]:
    img = pinta(n)
    img.save(os.path.join(RAIZ, nombre))
    print(f'  {nombre}  {n}×{n}')
