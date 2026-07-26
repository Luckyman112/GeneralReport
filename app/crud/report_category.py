from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.report_category import ReportCategory


async def get_by_regiment(db: AsyncSession, regiment_id: int) -> list[ReportCategory]:
    result = await db.execute(select(ReportCategory).where(ReportCategory.regiment_id == regiment_id))
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, category_id: int) -> ReportCategory | None:
    return await db.get(ReportCategory, category_id)


async def get_by_name(db: AsyncSession, *, regiment_id: int, name: str) -> ReportCategory | None:
    result = await db.execute(
        select(ReportCategory).where(ReportCategory.regiment_id == regiment_id, ReportCategory.name == name)
    )
    return result.scalar_one_or_none()


async def get_or_create_in_all_regiments(
    db: AsyncSession, *, name: str, fields: list[str]
) -> dict[int, ReportCategory]:
    """Для обязательного (is_mandatory) требования по повышению: категория с этим
    именем должна существовать в КАЖДОМ формировании — там, где её ещё нет, она
    создаётся с переданным шаблоном полей; там, где уже есть (по имени), просто
    переиспользуется как есть, без изменения полей."""
    from app.models.regiment import Regiment

    regiments = (await db.execute(select(Regiment))).scalars().all()
    result: dict[int, ReportCategory] = {}
    for regiment in regiments:
        existing = await get_by_name(db, regiment_id=regiment.id, name=name)
        if existing is not None:
            result[regiment.id] = existing
            continue
        category = ReportCategory(regiment_id=regiment.id, name=name, fields=fields)
        db.add(category)
        result[regiment.id] = category
    await db.commit()
    for category in result.values():
        await db.refresh(category)
    return result


async def create(
    db: AsyncSession,
    *,
    regiment_id: int,
    name: str,
    fields: list[str],
    points: int | None = None,
    participant_points: int | None = None,
    is_detention: bool = False,
) -> ReportCategory:
    category = ReportCategory(
        regiment_id=regiment_id,
        name=name,
        fields=fields,
        points=points,
        participant_points=participant_points,
        is_detention=is_detention,
    )
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
