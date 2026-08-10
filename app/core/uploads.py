"""Общий хелпер для приёма загружаемых картинок — используется везде, где
пользователь грузит изображение (рапорт, фото участника, карта Ивентрума).

Раньше каждый эндпоинт делал `content = await file.read()` целиком, ДО проверки
размера — недобросовестный клиент мог прислать многогигабайтное тело запроса и
забить память процесса ещё до того, как код успевал сказать "слишком большой".
Здесь чтение идёт чанками с обрывом сразу по превышению лимита. Также
Content-Type в заголовке запроса — то, что прислал клиент, а не факт; здесь
дополнительно проверяется, что байты реально декодируются как изображение."""
import io

from fastapi import UploadFile
from PIL import Image

from app.exceptions import AppError

_CHUNK_SIZE = 256 * 1024  # 256 КБ


async def read_image_upload(file: UploadFile, *, allowed_types: dict[str, str], max_size: int) -> tuple[bytes, str]:
    """allowed_types — {content_type: расширение}. Возвращает (content, ext) или
    бросает AppError с понятным сообщением (неверный тип/слишком большой/битый файл)."""
    ext = allowed_types.get(file.content_type)
    if ext is None:
        raise AppError("Разрешены только изображения: " + ", ".join(sorted(allowed_types)))

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size:
            raise AppError(f"Файл слишком большой (максимум {max_size // (1024 * 1024)} МБ)")
        chunks.append(chunk)
    content = b"".join(chunks)

    try:
        Image.open(io.BytesIO(content)).verify()
    except Exception:
        raise AppError("Файл повреждён или не является изображением")

    return content, ext


async def read_file_upload(file: UploadFile, *, allowed_types: dict[str, str], max_size: int) -> tuple[bytes, str]:
    """Тот же чанкованный приём с обрывом по превышению лимита, но БЕЗ
    Pillow-валидации байт — для файлов, которые не картинка (например видео-
    доказательство в отчёте Администрации). Доверяет Content-Type от клиента
    (в отличие от read_image_upload), поэтому используется только там, где
    последствия подмены типа файла не критичны (просто вложение к отчёту)."""
    ext = allowed_types.get(file.content_type)
    if ext is None:
        raise AppError("Недопустимый тип файла: " + ", ".join(sorted(allowed_types)))

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size:
            raise AppError(f"Файл слишком большой (максимум {max_size // (1024 * 1024)} МБ)")
        chunks.append(chunk)
    return b"".join(chunks), ext
