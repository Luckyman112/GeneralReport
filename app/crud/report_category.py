from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.report_category import ReportCategory

_LOAD_OPTIONS = [
    selectinload(ReportCategory.min_rank),
    selectinload(ReportCategory.required_specialization),
    selectinload(ReportCategory.required_squad),
]


async def get_by_regiment(db: AsyncSession, regiment_id: int) -> list[ReportCategory]:
    result = await db.execute(
        select(ReportCategory).where(ReportCategory.regiment_id == regiment_id).options(*_LOAD_OPTIONS)
    )
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, category_id: int) -> ReportCategory | None:
    return await db.get(ReportCategory, category_id, options=_LOAD_OPTIONS, populate_existing=True)


async def get_by_name(db: AsyncSession, *, regiment_id: int, name: str) -> ReportCategory | None:
    result = await db.execute(
        select(ReportCategory)
        .where(ReportCategory.regiment_id == regiment_id, ReportCategory.name == name)
        .options(*_LOAD_OPTIONS)
    )
    return result.scalar_one_or_none()


async def get_or_create_in_all_regiments(
    db: AsyncSession,
    *,
    name: str,
    fields: list[str],
    min_rank_id: int | None = None,
    commander_only: bool = False,
) -> dict[int, ReportCategory]:
    """Для обязательного (is_mandatory) требования по повышению: категория с этим
    именем должна существовать в КАЖДОМ формировании — там, где её ещё нет, она
    создаётся с переданным шаблоном полей. Там, где уже есть (по имени) — это
    единственный "конструктор" обязательных категорий, поэтому непустой список
    fields и commander_only применяются как явное обновление шаблона везде;
    min_rank_id — только если передан не None. Пустой fields ("не важно, просто
    переиспользуется") оставляет уже заданные поля как есть — используется при
    добавлении того же обязательного требования для другого звания без
    повторного описания полей."""
    from app.models.regiment import Regiment

    regiments = (await db.execute(select(Regiment))).scalars().all()
    result: dict[int, ReportCategory] = {}
    for regiment in regiments:
        existing = await get_by_name(db, regiment_id=regiment.id, name=name)
        if existing is not None:
            if fields:
                existing.fields = fields
            if min_rank_id is not None:
                existing.min_rank_id = min_rank_id
            existing.commander_only = commander_only
            result[regiment.id] = existing
            continue
        category = ReportCategory(
            regiment_id=regiment.id,
            name=name,
            fields=fields,
            min_rank_id=min_rank_id,
            commander_only=commander_only,
        )
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
    min_rank_id: int | None = None,
    commander_only: bool = False,
    required_specialization_id: int | None = None,
    open_to_regiment_leadership: bool = False,
    required_squad_id: int | None = None,
    mirrors_to_category_id: int | None = None,
) -> ReportCategory:
    category = ReportCategory(
        regiment_id=regiment_id,
        name=name,
        fields=fields,
        points=points,
        participant_points=participant_points,
        is_detention=is_detention,
        min_rank_id=min_rank_id,
        commander_only=commander_only,
        required_specialization_id=required_specialization_id,
        open_to_regiment_leadership=open_to_regiment_leadership,
        required_squad_id=required_squad_id,
        mirrors_to_category_id=mirrors_to_category_id,
    )
    db.add(category)
    await db.commit()
    return await get_by_id(db, category.id)


async def update(db: AsyncSession, category: ReportCategory, **changes) -> ReportCategory:
    """changes — только реально переданные клиентом поля (см. exclude_unset в
    эндпоинте), поэтому points: None здесь означает явную очистку, а не "не трогать"."""
    for key, value in changes.items():
        setattr(category, key, value)
    await db.commit()
    return await get_by_id(db, category.id)


async def delete(db: AsyncSession, category: ReportCategory) -> None:
    await db.delete(category)
    await db.commit()
