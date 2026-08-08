"""Генерация карточки-досье операции (PNG) для сообщения бота об одобренном
ивенте — см. решение пользователя: не просто embed-поля, а сгенерированное
изображение в духе "оперативного досье" (см. референс-скриншоты)."""
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

_WIDTH = 1000
_MIN_HEIGHT = 580
_PADDING = 40
_BG = "#11151c"
_BORDER = "#2a3441"
_ACCENT = "#5b8dd6"
_ACCENT_DIM = "#39547a"
_RED = "#c0392b"
_TEXT = "#e6ebf2"
_TEXT_DIM = "#8b97a8"

# Незаполненные на момент подачи поля ("узнается по ходу брифинга", см.
# решение пользователя) — не пустая строка, а явный плейсхолдер
_TBD_PLACEHOLDER = "По решению командного состава во время брифинга"

_MAP_BOX_MIN_HEIGHT = 280
_COL_WIDTH = 560
_COL_GAP = 30


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


def _build_sections(
    *, summary: str | None, objective: str | None, tasks: list[str] | None, participants_label: str | None, threat: str | None
) -> list[tuple[str, list[str]]]:
    """Возвращает [(заголовок, [строки текста]), ...] — задачи нумеруются
    списком (см. "доп. задачи" в решении пользователя); незаполненные
    состав/задачи — не пропускаются, а показывают плейсхолдер "узнается на
    брифинге", а не пустоту."""
    sections: list[tuple[str, list[str]]] = []
    if summary:
        sections.append(("СВОДКА ОПЕРАЦИИ", [summary]))
    if objective:
        sections.append(("ЦЕЛЬ ОПЕРАЦИИ", [objective]))

    clean_tasks = [t for t in (tasks or []) if t and t.strip()]
    if clean_tasks:
        label = "ЗАДАЧА" if len(clean_tasks) == 1 else "ЗАДАЧИ"
        lines = [clean_tasks[0]] if len(clean_tasks) == 1 else [f"{i + 1}. {t}" for i, t in enumerate(clean_tasks)]
        sections.append((label, lines))

    sections.append(("СОСТАВ", [participants_label or _TBD_PLACEHOLDER]))

    if threat:
        sections.append(("УГРОЗА", [threat]))
    return sections


def render_operation_dossier(
    *,
    event_id: int,
    title: str,
    summary: str | None,
    objective: str | None,
    tasks: list[str] | None,
    threat: str | None,
    participants_label: str | None,
    map_name: str | None,
    map_image: bytes | None = None,
) -> bytes:
    sections = _build_sections(
        summary=summary, objective=objective, tasks=tasks, participants_label=participants_label, threat=threat
    )

    # первый проход — только для измерения текста (реальный размер холста
    # заранее неизвестен, зависит от объёма контента, напр. числа задач)
    probe = Image.new("RGB", (10, 10))
    probe_draw = ImageDraw.Draw(probe)
    label_font = _title_font(16, 600)
    body_font = _mono_font(14)

    content_height = 0
    for _, lines in sections:
        content_height += 24  # заголовок секции
        for line in lines:
            content_height += 20 * len(_wrap_text(probe_draw, line, body_font, _COL_WIDTH))
        content_height += 14  # отступ после секции

    header_height = _PADDING - 8 + 26 + 58 + 24
    footer_height = 40
    left_col_bottom = header_height + content_height
    right_col_bottom = header_height + _MAP_BOX_MIN_HEIGHT
    height = max(_MIN_HEIGHT, left_col_bottom + footer_height, right_col_bottom + footer_height)

    img = Image.new("RGB", (_WIDTH, height), _BG)
    draw = ImageDraw.Draw(img)

    # рамка + левая акцентная полоса
    draw.rectangle([0, 0, _WIDTH - 1, height - 1], outline=_BORDER, width=2)
    draw.rectangle([0, 0, 6, height], fill=_ACCENT)

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

    stamp_pos = (right_edge - 210, fy + 6)

    y += 58
    draw.line([(left, y), (right_edge, y)], fill=_BORDER, width=1)
    y += 24

    # левая колонка — секции
    for label, lines in sections:
        draw.text((left, y), label, font=label_font, fill=_ACCENT)
        y += 24
        for line in lines:
            for wrapped in _wrap_text(draw, line, body_font, _COL_WIDTH):
                draw.text((left, y), wrapped, font=body_font, fill=_TEXT)
                y += 20
        y += 14

    # правая колонка — карта (своя картинка, если загружена, иначе просто
    # название из каталога, см. решение пользователя)
    map_x0 = left + _COL_WIDTH + _COL_GAP
    map_y0 = header_height
    map_x1 = right_edge
    map_y1 = height - footer_height
    draw.rectangle([map_x0, map_y0, map_x1, map_y1], outline=_ACCENT_DIM, width=1)

    if map_image:
        try:
            pic = Image.open(BytesIO(map_image)).convert("RGB")
            box_w, box_h = map_x1 - map_x0 - 2, map_y1 - map_y0 - 2
            pic_ratio = pic.width / pic.height
            box_ratio = box_w / box_h
            if pic_ratio > box_ratio:
                new_h = box_h
                new_w = int(new_h * pic_ratio)
            else:
                new_w = box_w
                new_h = int(new_w / pic_ratio)
            pic = pic.resize((new_w, new_h), Image.LANCZOS)
            crop_x = (new_w - box_w) // 2
            crop_y = (new_h - box_h) // 2
            pic = pic.crop((crop_x, crop_y, crop_x + box_w, crop_y + box_h))
            img.paste(pic, (map_x0 + 1, map_y0 + 1))
        except Exception:
            map_image = None

    if not map_image:
        map_label_font = _mono_font(12, 500)
        draw.text((map_x0 + 14, map_y0 + 14), "КАРТА", font=map_label_font, fill=_TEXT_DIM)
        map_name_font = _title_font(22, 600)
        map_text = map_name or "— не выбрана —"
        mw = draw.textlength(map_text, font=map_name_font)
        box_w = map_x1 - map_x0
        draw.text(
            (map_x0 + max(14, (box_w - mw) / 2), (map_y0 + map_y1) / 2 - 12), map_text, font=map_name_font, fill=_TEXT
        )
    elif map_name:
        # подпись поверх картинки снизу, полупрозрачная плашка
        cap_font = _mono_font(13, 600)
        cw = draw.textlength(map_name, font=cap_font)
        cap_layer = Image.new("RGBA", (int(cw) + 24, 30), (17, 21, 28, 200))
        cap_draw = ImageDraw.Draw(cap_layer)
        cap_draw.text((12, 7), map_name, font=cap_font, fill=_TEXT)
        img.paste(cap_layer, (map_x0 + 10, map_y1 - 40), cap_layer)

    # штамп рисуется поверх карты последним, чтобы своя картинка карты его не перекрывала
    _draw_stamp(img, stamp_pos)

    footer_font = _mono_font(11)
    footer_text = f"COLLAPSAR · ОПЕРАЦИЯ #{event_id}"
    fw = draw.textlength(footer_text, font=footer_font)
    draw.text((right_edge - fw, height - _PADDING + 6), footer_text, font=footer_font, fill=_TEXT_DIM)

    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()
