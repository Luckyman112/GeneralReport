"""Резервные копии базы данных — запуск pg_dump внутри Docker-контейнера Postgres
(collapsar-postgres, как и весь остальной проект это подразумевает), файлы кладутся
в backups/ в корне проекта (в .gitignore). Только администратор."""
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from app.api.deps import AccessContext, get_access_context
from app.config import settings
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.schemas.backup import BackupRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/backups", tags=["backups"])

POSTGRES_CONTAINER_NAME = "collapsar-postgres"
BACKUPS_DIR = Path(__file__).resolve().parent.parent.parent / "backups"


def _require_admin(access: AccessContext) -> None:
    if not access.is_admin:
        raise ForbiddenError("Резервные копии доступны только администратору")


def _safe_filename(filename: str) -> Path:
    path = (BACKUPS_DIR / filename).resolve()
    if BACKUPS_DIR.resolve() not in path.parents or not path.is_file():
        raise NotFoundError("Файл резервной копии не найден")
    return path


@router.get("", response_model=list[BackupRead])
async def list_backups(access: AccessContext = Depends(get_access_context)) -> list[BackupRead]:
    _require_admin(access)
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(BACKUPS_DIR.glob("*.sql"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [
        BackupRead(filename=f.name, size_bytes=f.stat().st_size, created_at=datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc))
        for f in files
    ]


def run_pg_dump(*, label: str) -> BackupRead:
    """Общая логика создания резервной копии — используется и ручной кнопкой, и
    фоновым планировщиком (см. app/core/backup_scheduler.py)."""
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

    parsed = urlparse(settings.database_url.replace("postgresql+asyncpg://", "postgresql://"))
    db_user = parsed.username or "postgres"
    db_password = parsed.password or ""
    db_name = (parsed.path or "/").lstrip("/")

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    filename = f"backup_{timestamp}.sql"
    target = BACKUPS_DIR / filename

    command = ["docker", "exec", "-e", f"PGPASSWORD={db_password}", POSTGRES_CONTAINER_NAME, "pg_dump", "-U", db_user, db_name]
    logger.info("%s запустил резервное копирование БД -> %s", label, filename)

    try:
        with open(target, "wb") as f:
            result = subprocess.run(command, stdout=f, stderr=subprocess.PIPE, timeout=300)
    except FileNotFoundError as exc:
        raise AppError("Docker не найден в PATH — не удалось запустить pg_dump") from exc
    except subprocess.TimeoutExpired as exc:
        target.unlink(missing_ok=True)
        raise AppError("Резервное копирование не уложилось в таймаут (5 минут)") from exc

    if result.returncode != 0:
        target.unlink(missing_ok=True)
        error_text = result.stderr.decode("utf-8", errors="replace")
        logger.error("pg_dump завершился с ошибкой: %s", error_text)
        raise AppError(f"Не удалось создать резервную копию: {error_text[:500]}")

    _rotate_old_backups()

    stat = target.stat()
    return BackupRead(filename=filename, size_bytes=stat.st_size, created_at=datetime.now(timezone.utc))


def _rotate_old_backups() -> None:
    """Держим только settings.backup_retention_count последних файлов — старые
    удаляются автоматически после каждого нового бэкапа (ручного или планового)."""
    files = sorted(BACKUPS_DIR.glob("*.sql"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old_file in files[settings.backup_retention_count :]:
        try:
            old_file.unlink()
            logger.info("Автоматически удалена старая резервная копия: %s", old_file.name)
        except OSError as exc:
            logger.warning("Не удалось удалить старую резервную копию %s: %s", old_file.name, exc)


@router.post("", response_model=BackupRead, status_code=201)
async def create_backup(access: AccessContext = Depends(get_access_context)) -> BackupRead:
    _require_admin(access)
    return run_pg_dump(label=access.user.username)


@router.get("/{filename}/download")
async def download_backup(filename: str, access: AccessContext = Depends(get_access_context)) -> FileResponse:
    _require_admin(access)
    path = _safe_filename(filename)
    return FileResponse(path, filename=filename, media_type="application/sql")


@router.delete("/{filename}", status_code=204)
async def delete_backup(filename: str, access: AccessContext = Depends(get_access_context)) -> None:
    _require_admin(access)
    path = _safe_filename(filename)
    path.unlink()
    logger.info("%s удалил резервную копию %s", access.user.username, filename)
