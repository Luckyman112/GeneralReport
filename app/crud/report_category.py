from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.report_category import ReportCategory


async def get_by_regiment(db: AsyncSession, regiment_id: int) -> list[ReportCategory]:
    result = await db.execute(select(ReportCategory).where(ReportCategory.regiment_id == regiment_id))
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, category_id: int) -> ReportCategory | None:
    return await db.get(ReportCategory, category_id)


async def create(
    db: AsyncSession, *, regiment_id: int, name: str, fields: list[str], points: int | None = None
) -> ReportCategory:
    category = ReportCategory(regiment_id=regiment_id, name=name, fields=fields, points=points)
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


async def update(db: AsyncSession, category: ReportCategory, **changes) -> ReportCategory:
    """changes — только реально переданные клиентом поля (см. exclude_unset в
    эндпоинте), поэтому points: None здесь означает явную очистку, а не "не трогать"."""
    for key, value in changes.items():
        setattr(category, key, value)
    await db.commit()
    await db.refresh(category)
    return category


async def delete(db: AsyncSession, category: ReportCategory) -> None:
    await db.delete(category)
    await db.commit()
