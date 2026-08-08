"""Генерация карточки-досье операции (PNG) для сообщения бота об одобренном
ивенте — см. решение пользователя: не просто embed-поля, а сгенерированное
изображение в духе "оперативного досье" (см. референс-скриншоты)."""
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

_WIDTH = 1000
_HEIGHT = 580
_PADDING = 40
_BG = "#11151c"
_BORDER = "#2a3441"
_ACCENT = "#5b8dd6"
_ACCENT_DIM = "#39547a"
_RED = "#c0392b"
_TEXT = "#e6ebf2"
_TEXT_DIM = "#8b97a8"


def _font(name: str, size: int, weight: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(_FONTS_DIR / name), size)
    try:
        font.set_variation_by_axes([weight])
    except Exception:
        pass
    return font


def _title_font(size: int, weight: int = 700) -> ImageFont.FreeTypeFont:
    return _font("Oswald-Variable.ttf", size, weight)


def _mono_font(size: int, weight: int = 400) -> ImageFont.FreeTypeFont:
    return _font("JetBrainsMono-Variable.ttf", size, weight)


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _draw_stamp(img: Image.Image, top_left: tuple[int, int]) -> None:
    """Штамп "СОВЕРШЕННО СЕКРЕТНО" — рисуется на отдельном прозрачном слое и
    вклеивается повёрнутым, как на референсе."""
    label = "СОВЕРШЕННО СЕКРЕТНО"
    font = _title_font(20, 700)
    layer = Image.new("RGBA", (260, 60), (0, 0, 0, 0))
    layer_draw = ImageDraw.Draw(layer)
    layer_draw.rectangle([4, 4, 255, 55], outline=_RED, width=3)
    w = layer_draw.textlength(label, font=font)
    layer_draw.text(((260 - w) / 2, 16), label, font=font, fill=_RED)
    rotated = layer.rotate(-6, expand=True, resample=Image.BICUBIC)
    img.paste(rotated, top_left, rotated)


def render_operation_dossier(
    *,
    event_id: int,
    title: str,
    summary: str | None,
    objective: str | None,
    task: str | None,
    threat: str | None,
    participants_label: str | None,
    map_name: str | None,
) -> bytes:
    img = Image.new("RGB", (_WIDTH, _HEIGHT), _BG)
    draw = ImageDraw.Draw(img)

    # рамка + левая акцентная полоса
    draw.rectangle([0, 0, _WIDTH - 1, _HEIGHT - 1], outline=_BORDER, width=2)
    draw.rectangle([0, 0, 6, _HEIGHT], fill=_ACCENT)

    left = _PADDING
    right_edge = _WIDTH - _PADDING
    y = _PADDING - 8

    # верхний тег файла
    tag_font = _mono_font(13)
    draw.text((left, y), f"ФАЙЛ #{event_id} · ДОСТУП ОГРАНИЧЕН", font=tag_font, fill=_TEXT_DIM)
    y += 26

    # заголовок + факция справа
    title_font = _title_font(40, 700)
    draw.text((left, y), title.upper(), font=title_font, fill=_TEXT)

    faction_font = _mono_font(13, 500)
    faction_lines = ["COLLAPSAR", "ОПЕРАТИВНЫЙ ОТДЕЛ"]
    fy = y + 2
    for line in faction_lines:
        w = draw.textlength(line, font=faction_font)
        draw.text((right_edge - w, fy), line, font=faction_font, fill=_TEXT_DIM)
        fy += 18

    _draw_stamp(img, (right_edge - 210, fy + 6))

    y += 58
    draw.line([(left, y), (right_edge, y)], fill=_BORDER, width=1)
    y += 24

    # левая колонка — секции
    col_width = 560
    label_font = _title_font(16, 600)
    body_font = _mono_font(14)
    sections = [
        ("СВОДКА ОПЕРАЦИИ", summary),
        ("ЦЕЛЬ ОПЕРАЦИИ", objective),
        ("ЗАДАЧА", task),
        ("СОСТАВ", participants_label),
        ("УГРОЗА", threat),
    ]
    for label, value in sections:
        if not value:
            continue
        draw.text((left, y), label, font=label_font, fill=_ACCENT)
        y += 24
        for line in _wrap_text(draw, value, body_font, col_width):
            draw.text((left, y), line, font=body_font, fill=_TEXT)
            y += 20
        y += 14

    # правая колонка — карта
    map_x0 = left + col_width + 30
    map_y0 = _PADDING + 82
    map_x1 = right_edge
    map_y1 = _HEIGHT - 60
    draw.rectangle([map_x0, map_y0, map_x1, map_y1], outline=_ACCENT_DIM, width=1)
    map_label_font = _mono_font(12, 500)
    draw.text((map_x0 + 14, map_y0 + 14), "КАРТА", font=map_label_font, fill=_TEXT_DIM)
    map_name_font = _title_font(22, 600)
    map_text = map_name or "— не выбрана —"
    mw = draw.textlength(map_text, font=map_name_font)
    box_w = map_x1 - map_x0
    draw.text((map_x0 + max(14, (box_w - mw) / 2), (map_y0 + map_y1) / 2 - 12), map_text, font=map_name_font, fill=_TEXT)

    footer_font = _mono_font(11)
    footer_text = f"COLLAPSAR · ОПЕРАЦИЯ #{event_id}"
    fw = draw.textlength(footer_text, font=footer_font)
    draw.text((right_edge - fw, _HEIGHT - _PADDING + 6), footer_text, font=footer_font, fill=_TEXT_DIM)

    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()
