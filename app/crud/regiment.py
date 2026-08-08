from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.regiment import Regiment
from app.models.report_category import ReportCategory

DETENTION_CATEGORY_NAME = "Задержание"
PROMOTION_CATEGORY_NAME = "Повышение"
DEMOTION_CATEGORY_NAME = "Понижение"
TRAINING_CATEGORY_NAME = "Обучение на специализации"
STAFF_REGIMENT_NAME = "Штаб"
# Обучение НОВИЧКОВ формирования (не путать с TRAINING_CATEGORY_NAME — та про
# выдачу мед/пилот/инж специализаций инструктором). Заводится в каждом
# формировании — min_rank_id (кто может обучать, например "Капрал+") командир
# настраивает сам как у обычной категории. Копия каждого поданного рапорта
# автоматически зеркалится в одноимённую категорию Штаба — см.
# ReportCategory.mirrors_to_category_id и _ensure_recruit_training_category ниже.
RECRUIT_TRAINING_CATEGORY_NAME = "Обучение рекрута"
RECRUIT_TRAINING_FIELDS = [
    {"name": "Рекрут", "type": "roster", "allowed_regiment_ids": [], "allow_manual": True},
    {"name": "Заметки", "type": "text", "allowed_regiment_ids": []},
]

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

    await _ensure_recruit_training_category(db, regiment)

    return regiment


async def _ensure_recruit_training_category(db: AsyncSession, regiment: Regiment) -> None:
    """Заводит "Обучение рекрута" этому формированию, зазеркаленную в одноимённую
    категорию Штаба (если она уже есть) — см. RECRUIT_TRAINING_CATEGORY_NAME.
    Сам Штаб (когда заводят его самого) — конечная точка, mirrors_to_category_id
    не выставляется."""
    existing = await db.execute(
        select(ReportCategory).where(
            ReportCategory.regiment_id == regiment.id, ReportCategory.name == RECRUIT_TRAINING_CATEGORY_NAME
        )
    )
    if existing.scalar_one_or_none() is not None:
        return

    mirrors_to_category_id = None
    if regiment.name != STAFF_REGIMENT_NAME:
        hq_result = await db.execute(select(Regiment).where(Regiment.name == STAFF_REGIMENT_NAME))
        hq = hq_result.scalar_one_or_none()
        if hq is not None:
            hq_category_result = await db.execute(
                select(ReportCategory).where(
                    ReportCategory.regiment_id == hq.id, ReportCategory.name == RECRUIT_TRAINING_CATEGORY_NAME
                )
            )
            hq_category = hq_category_result.scalar_one_or_none()
            if hq_category is not None:
                mirrors_to_category_id = hq_category.id

    db.add(
        ReportCategory(
            regiment_id=regiment.id,
            name=RECRUIT_TRAINING_CATEGORY_NAME,
            fields=RECRUIT_TRAINING_FIELDS,
            mirrors_to_category_id=mirrors_to_category_id,
        )
    )
    await db.commit()


async def update(db: AsyncSession, regiment: Regiment, **changes) -> Regiment:
    """changes — только реально переданные клиентом поля (exclude_unset в
    эндпоинте), поэтому color: None здесь означает явную очистку, а не "не трогать"."""
    for key, value in changes.items():
        setattr(regiment, key, value)
    await db.commit()
    await db.refresh(regiment)
    return regiment
