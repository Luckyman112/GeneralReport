from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.regiment import Regiment
from app.models.report_category import ReportCategory

DETENTION_CATEGORY_NAME = "Задержание"
PROMOTION_CATEGORY_NAME = "Повышение"
DEMOTION_CATEGORY_NAME = "Понижение"
TRAINING_CATEGORY_NAME = "Обучение на специализации"

# Базовый набор обычных (не системных) категорий рапортов — заводится каждому
# новому формированию сразу при создании (см. решение пользователя), в
# дополнение к системным выше. Даёт баллы и подавшему, и участникам из
# ростер-поля "Состав" — командир может донастроить/добавить свои поля потом
# как обычно, это просто стартовый набор, не системные категории.
BASE_CATEGORY_SET = [
    {
        "name": "Тренировка",
        "fields": [
            {"name": "Проводящий тренировку", "type": "roster", "allowed_regiment_ids": [], "default_self": True},
            {"name": "Тип тренировки", "type": "text", "allowed_regiment_ids": []},
            {"name": "Состав", "type": "roster", "allowed_regiment_ids": []},
            {"name": "Заметки", "type": "text", "allowed_regiment_ids": []},
        ],
        "points": 1,
        "participant_points": 1,
    },
    {
        "name": "Пост",
        "fields": [
            {"name": "Заступивший на пост", "type": "roster", "allowed_regiment_ids": [], "default_self": True},
            {"name": "Место несения поста", "type": "text", "allowed_regiment_ids": []},
            {"name": "Кто поставил на пост", "type": "roster", "allowed_regiment_ids": []},
            {"name": "Состав", "type": "roster", "allowed_regiment_ids": []},
            {"name": "Заметки", "type": "text", "allowed_regiment_ids": []},
        ],
        "points": 1,
        "participant_points": 1,
    },
    {
        "name": "Патруль",
        "fields": [
            {"name": "Маршрут патрулирования", "type": "text", "allowed_regiment_ids": []},
            {"name": "Время", "type": "text", "allowed_regiment_ids": []},
            {"name": "Состав", "type": "roster", "allowed_regiment_ids": []},
        ],
        "points": 1,
        "participant_points": 1,
    },
    {
        "name": "Боевой вылет",
        "fields": [
            {"name": "Командующий формированием", "type": "roster", "allowed_regiment_ids": [], "default_self": True},
            {"name": "Цель вылета", "type": "text", "allowed_regiment_ids": []},
            {"name": "Состав", "type": "roster", "allowed_regiment_ids": []},
            {"name": "Результат", "type": "text", "allowed_regiment_ids": []},
        ],
        "points": 1,
        "participant_points": 1,
    },
    {
        "name": "Защита ОВО",
        "fields": [
            {"name": "Командующий формированием", "type": "roster", "allowed_regiment_ids": [], "default_self": True},
            {"name": "Объект", "type": "text", "allowed_regiment_ids": []},
            {"name": "Состав", "type": "roster", "allowed_regiment_ids": []},
            {"name": "Результат", "type": "text", "allowed_regiment_ids": []},
        ],
        "points": 1,
        "participant_points": 1,
    },
]


async def get_all(db: AsyncSession, *, include_archived: bool = False) -> list[Regiment]:
    query = select(Regiment)
    if not include_archived:
        query = query.where(Regiment.is_archived.is_(False))
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, regiment_id: int) -> Regiment | None:
    return await db.get(Regiment, regiment_id)


async def create(
    db: AsyncSession,
    *,
    name: str,
    discord_role_id: str,
    color: str | None = None,
    discord_channel_url: str | None = None,
    is_jedi_order: bool = False,
    starting_rank_id: int | None = None,
) -> Regiment:
    regiment = Regiment(
        name=name,
        discord_role_id=discord_role_id,
        color=color,
        discord_channel_url=discord_channel_url,
        is_jedi_order=is_jedi_order,
        starting_rank_id=starting_rank_id,
    )
    db.add(regiment)
    await db.commit()
    await db.refresh(regiment)

    # Категории "задержание" и "повышение" заводятся автоматически для каждого
    # формирования — обе системные, их не создают и не настраивают вручную
    # (см. is_detention/is_promotion)
    db.add(ReportCategory(regiment_id=regiment.id, name=DETENTION_CATEGORY_NAME, fields=[], is_detention=True))
    db.add(ReportCategory(regiment_id=regiment.id, name=PROMOTION_CATEGORY_NAME, fields=[], is_promotion=True))
    db.add(ReportCategory(regiment_id=regiment.id, name=DEMOTION_CATEGORY_NAME, fields=[], is_demotion=True))
    db.add(ReportCategory(regiment_id=regiment.id, name=TRAINING_CATEGORY_NAME, fields=[], is_training=True))
    for spec in BASE_CATEGORY_SET:
        db.add(
            ReportCategory(
                regiment_id=regiment.id,
                name=spec["name"],
                fields=spec["fields"],
                points=spec["points"],
                participant_points=spec["participant_points"],
            )
        )
    await db.commit()

    return regiment


async def update(db: AsyncSession, regiment: Regiment, **changes) -> Regiment:
    """changes — только реально переданные клиентом поля (exclude_unset в
    эндпоинте), поэтому color: None здесь означает явную очистку, а не "не трогать"."""
    for key, value in changes.items():
        setattr(regiment, key, value)
    await db.commit()
    await db.refresh(regiment)
    return regiment
