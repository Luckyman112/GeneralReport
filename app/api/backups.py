"""Резервные копии базы данных — запуск pg_dump внутри Docker-контейнера Postgres
(collapsar-postgres, как и весь остальной проект это подразумевает), файлы кладутся
в backups/ в корне проекта (в .gitignore). Только администратор."""
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AccessContext, get_access_context
from app.config import settings
from app.crud import app_settings as app_settings_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.models.rank import RankTier
from app.models.regiment import Regiment
from app.models.report_category import ReportCategory
from app.models.specialization import Specialization
from app.schemas.backup import BackupRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/backups", tags=["backups"])
sessions_router = APIRouter(prefix="/admin/sessions", tags=["backups"])

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


def _row_to_dict(obj, *, exclude: set[str] = frozenset()) -> dict:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns if c.name not in exclude}


@router.get("/settings-export")
async def export_settings(
    db: AsyncSession = Depends(get_db), access: AccessContext = Depends(get_access_context)
) -> JSONResponse:
    # settings-only export, separate from full db backup
    _require_admin(access)

    tiers_result = await db.execute(select(RankTier).options(selectinload(RankTier.ranks)).order_by(RankTier.order))
    tiers = list(tiers_result.scalars().all())
    regiments_result = await db.execute(select(Regiment).order_by(Regiment.id))
    regiments = list(regiments_result.scalars().all())
    categories_result = await db.execute(select(ReportCategory).order_by(ReportCategory.regiment_id, ReportCategory.id))
    categories = list(categories_result.scalars().all())
    specializations_result = await db.execute(select(Specialization).order_by(Specialization.id))
    specializations = list(specializations_result.scalars().all())

    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "rank_tiers": [
            {**_row_to_dict(tier, exclude={"id"}), "ranks": [_row_to_dict(r, exclude={"tier_id"}) for r in tier.ranks]}
            for tier in tiers
        ],
        "regiments": [_row_to_dict(r) for r in regiments],
        "report_categories": [_row_to_dict(c) for c in categories],
        "specializations": [_row_to_dict(s) for s in specializations],
    }

    filename = f"settings_{datetime.now(timezone.utc).strftime('%Y-%m-%d_%H%M%S')}.json"
    return JSONResponse(content=payload, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@sessions_router.post("/revoke-all", status_code=204)
async def revoke_all_sessions(
    db: AsyncSession = Depends(get_db), access: AccessContext = Depends(get_access_context)
) -> None:
    # kill all sessions, e.g. after a leaked password
    _require_admin(access)
    await app_settings_crud.revoke_all_sessions(db)
    logger.warning("%s принудительно отозвал все сессии", access.user.username)


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
