from pathlib import Path
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.report_image import ReportImage

UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / "uploads" / "reports"


async def create(db: AsyncSession, *, report_id: UUID, filename: str, url: str) -> ReportImage:
    image = ReportImage(report_id=report_id, filename=filename, url=url)
    db.add(image)
    await db.commit()
    await db.refresh(image)
    return image


async def get_by_id(db: AsyncSession, image_id: int) -> ReportImage | None:
    return await db.get(ReportImage, image_id)


async def delete(db: AsyncSession, image: ReportImage) -> None:
    file_path = UPLOAD_ROOT / str(image.report_id) / image.filename
    file_path.unlink(missing_ok=True)
    await db.delete(image)
    await db.commit()
