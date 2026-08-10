from datetime import date

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import AppError
from app.models.specialization import (
    InstructorRole,
    Specialization,
    SpecializationBan,
    SpecializationPrerequisite,
    UserSpecialization,
)
from app.models.user import User

_GRANT_LOAD_OPTIONS = [
    selectinload(UserSpecialization.specialization),
    selectinload(UserSpecialization.granted_by).selectinload(User.rank),
]
_BAN_LOAD_OPTIONS = [
    selectinload(SpecializationBan.specialization),
    selectinload(SpecializationBan.created_by).selectinload(User.rank),
]


async def count_grants_by_instructor(db: AsyncSession, *, since=None) -> list[tuple[int, int]]:
    """Возвращает [(granted_by_user_id, count), ...] — сколько специализаций выдал
    каждый инструктор/админ, для дашборда активности. since — только выдачи не
    раньше этой даты (за неделю/месяц), None — за всё время."""
    query = select(UserSpecialization.granted_by_user_id, func.count(UserSpecialization.id))
    if since is not None:
        query = query.where(UserSpecialization.granted_at >= since)
    query = query.group_by(UserSpecialization.granted_by_user_id)
    result = await db.execute(query)
    return list(result.all())


_SPECIALIZATION_LOAD_OPTIONS = [
    selectinload(Specialization.min_rank),
    selectinload(Specialization.parent),
    selectinload(Specialization.required_regiment),
]


async def get_all(db: AsyncSession) -> list[Specialization]:
    result = await db.execute(
        select(Specialization).options(*_SPECIALIZATION_LOAD_OPTIONS).order_by(Specialization.name)
    )
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, specialization_id: int) -> Specialization | None:
    return await db.get(Specialization, specialization_id, options=_SPECIALIZATION_LOAD_OPTIONS)


async def list_grants_by_category(db: AsyncSession, category: str) -> list[UserSpecialization]:
    """Все выдачи специализаций дисциплины (медик/пилот/инженер) — основа для
    кросс-формационного ростера DEP/CU (см. app/api/specializations.py)."""
    result = await db.execute(
        select(UserSpecialization)
        .join(Specialization, UserSpecialization.specialization_id == Specialization.id)
        .where(Specialization.category == category)
        .options(
            selectinload(UserSpecialization.specialization),
            selectinload(UserSpecialization.user).selectinload(User.rank),
        )
    )
    return list(result.scalars().all())


async def create(
    db: AsyncSession,
    *,
    code: str,
    name: str,
    category: str,
    min_rank_id: int | None = None,
    required_regiment_id: int | None = None,
    parent_id: int | None = None,
    prerequisite_specialization_ids: list[int] | None = None,
    is_singleton: bool = False,
) -> Specialization:
    specialization = Specialization(
        code=code,
        name=name,
        category=category,
        min_rank_id=min_rank_id,
        required_regiment_id=required_regiment_id,
        parent_id=parent_id,
        is_singleton=is_singleton,
    )
    db.add(specialization)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(f"Специализация с кодом «{code}» уже существует")
    if prerequisite_specialization_ids:
        await _set_prerequisites(db, specialization.id, prerequisite_specialization_ids)
    await db.refresh(specialization, attribute_names=["min_rank"])
    return specialization


async def update(db: AsyncSession, specialization: Specialization, **changes) -> Specialization:
    """changes — только реально переданные клиентом поля (exclude_unset в
    эндпоинте), поэтому min_rank_id: None здесь означает явную очистку, а не
    "не трогать". prerequisite_specialization_ids не колонка Specialization —
    отдельная таблица, обрабатывается отдельно (полная замена набора, как
    fields у категорий рапортов)."""
    prerequisite_specialization_ids = changes.pop("prerequisite_specialization_ids", None)
    for key, value in changes.items():
        setattr(specialization, key, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(f"Специализация с кодом «{changes.get('code', specialization.code)}» уже существует")
    if prerequisite_specialization_ids is not None:
        await _set_prerequisites(db, specialization.id, prerequisite_specialization_ids)
    await db.refresh(specialization, attribute_names=["min_rank"])
    return specialization


async def _set_prerequisites(db: AsyncSession, specialization_id: int, required_ids: list[int]) -> None:
    await db.execute(
        SpecializationPrerequisite.__table__.delete().where(
            SpecializationPrerequisite.specialization_id == specialization_id
        )
    )
    for required_id in dict.fromkeys(required_ids):  # de-dupe, keep order
        if required_id == specialization_id:
            continue
        db.add(
            SpecializationPrerequisite(specialization_id=specialization_id, required_specialization_id=required_id)
        )
    await db.commit()


async def list_prerequisites(db: AsyncSession, specialization_id: int) -> list[Specialization]:
    result = await db.execute(
        select(Specialization)
        .join(
            SpecializationPrerequisite,
            SpecializationPrerequisite.required_specialization_id == Specialization.id,
        )
        .where(SpecializationPrerequisite.specialization_id == specialization_id)
        .order_by(Specialization.name)
    )
    return list(result.scalars().all())


async def get_singleton_holder_id(db: AsyncSession, *, specialization_id: int) -> int | None:
    """user_id текущего держателя специализации-исключения (is_singleton) —
    None, если её ещё никто не держит. См. _check_can_grant."""
    result = await db.execute(
        select(UserSpecialization.user_id).where(UserSpecialization.specialization_id == specialization_id)
    )
    return result.scalars().first()


async def has_specialization(db: AsyncSession, *, user_id: int, specialization_id: int) -> bool:
    result = await db.execute(
        select(func.count(UserSpecialization.id)).where(
            UserSpecialization.user_id == user_id, UserSpecialization.specialization_id == specialization_id
        )
    )
    return result.scalar_one() > 0


async def delete(db: AsyncSession, specialization: Specialization) -> None:
    await db.delete(specialization)
    await db.commit()


async def list_for_user(db: AsyncSession, *, user_id: int) -> list[UserSpecialization]:
    result = await db.execute(
        select(UserSpecialization)
        .where(UserSpecialization.user_id == user_id)
        .options(*_GRANT_LOAD_OPTIONS)
        .order_by(UserSpecialization.granted_at.desc())
    )
    return list(result.scalars().all())


async def count_by_category(db: AsyncSession, *, user_id: int, category: str) -> int:
    result = await db.execute(
        select(func.count(UserSpecialization.id))
        .join(Specialization, UserSpecialization.specialization_id == Specialization.id)
        .where(UserSpecialization.user_id == user_id, Specialization.category == category)
    )
    return result.scalar_one()


async def has_unlimited_training(db: AsyncSession, *, user_id: int, unlimited_code: str) -> bool:
    result = await db.execute(
        select(func.count(UserSpecialization.id))
        .join(Specialization, UserSpecialization.specialization_id == Specialization.id)
        .where(UserSpecialization.user_id == user_id, Specialization.code == unlimited_code)
    )
    return result.scalar_one() > 0


async def grant(db: AsyncSession, *, user_id: int, specialization_id: int, granted_by_user_id: int) -> UserSpecialization:
    grant_row = UserSpecialization(
        user_id=user_id, specialization_id=specialization_id, granted_by_user_id=granted_by_user_id
    )
    db.add(grant_row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError("Эта специализация уже выдана этому бойцу")
    result = await db.execute(
        select(UserSpecialization).where(UserSpecialization.id == grant_row.id).options(*_GRANT_LOAD_OPTIONS)
    )
    return result.scalar_one()


async def get_grant_by_id(db: AsyncSession, grant_id: int) -> UserSpecialization | None:
    return await db.get(UserSpecialization, grant_id)


async def revoke(db: AsyncSession, grant_row: UserSpecialization) -> None:
    await db.delete(grant_row)
    await db.commit()


# --- Временные запреты на обучение --------------------------------------------------


async def list_bans_for_user(db: AsyncSession, *, user_id: int) -> list[SpecializationBan]:
    result = await db.execute(
        select(SpecializationBan)
        .where(SpecializationBan.user_id == user_id)
        .options(*_BAN_LOAD_OPTIONS)
        .order_by(SpecializationBan.until_date.desc())
    )
    return list(result.scalars().all())


async def list_active_bans(db: AsyncSession) -> list[SpecializationBan]:
    """Все действующие сейчас запреты (не бессрочные с истёкшим сроком) —
    сводным списком по всем бойцам, для инструкторской."""
    result = await db.execute(
        select(SpecializationBan)
        .where((SpecializationBan.until_date.is_(None)) | (SpecializationBan.until_date >= date.today()))
        .options(*_BAN_LOAD_OPTIONS, selectinload(SpecializationBan.user).selectinload(User.rank))
        .order_by(SpecializationBan.until_date.asc().nulls_last())
    )
    return list(result.scalars().all())


async def get_active_blocking_ban(
    db: AsyncSession, *, user_id: int, specialization_id: int
) -> SpecializationBan | None:
    """Ищет действующий запрет — until_date >= сегодня (временный) ИЛИ
    until_date IS NULL (бессрочный) — либо именно на эту специализацию, либо
    общий (specialization_id IS NULL — на любое обучение)."""
    result = await db.execute(
        select(SpecializationBan)
        .where(
            SpecializationBan.user_id == user_id,
            (SpecializationBan.until_date.is_(None)) | (SpecializationBan.until_date >= date.today()),
            (SpecializationBan.specialization_id == specialization_id)
            | (SpecializationBan.specialization_id.is_(None)),
        )
        .options(*_BAN_LOAD_OPTIONS)
        .order_by(SpecializationBan.until_date.desc().nullsfirst())
    )
    return result.scalars().first()


async def create_ban(
    db: AsyncSession,
    *,
    user_id: int,
    specialization_id: int | None,
    until_date: date | None,
    reason: str | None,
    created_by_user_id: int,
) -> SpecializationBan:
    ban = SpecializationBan(
        user_id=user_id,
        specialization_id=specialization_id,
        until_date=until_date,
        reason=reason,
        created_by_user_id=created_by_user_id,
    )
    db.add(ban)
    await db.commit()
    result = await db.execute(select(SpecializationBan).where(SpecializationBan.id == ban.id).options(*_BAN_LOAD_OPTIONS))
    return result.scalar_one()


async def get_ban_by_id(db: AsyncSession, ban_id: int) -> SpecializationBan | None:
    return await db.get(SpecializationBan, ban_id)


async def delete_ban(db: AsyncSession, ban: SpecializationBan) -> None:
    await db.delete(ban)
    await db.commit()


# --- Роли инструкторов (Discord-роль -> дисциплина/"учит всему") --------------------


async def list_instructor_roles(db: AsyncSession) -> list[InstructorRole]:
    result = await db.execute(select(InstructorRole).order_by(InstructorRole.label))
    return list(result.scalars().all())


async def get_instructor_role_by_id(db: AsyncSession, instructor_role_id: int) -> InstructorRole | None:
    return await db.get(InstructorRole, instructor_role_id)


async def create_instructor_role(
    db: AsyncSession,
    *,
    discord_role_id: str,
    label: str,
    discipline: str | None,
    can_teach_all: bool,
    tier: str = "instructor",
) -> InstructorRole:
    row = InstructorRole(
        discord_role_id=discord_role_id,
        label=label,
        discipline=discipline,
        can_teach_all=can_teach_all,
        tier=tier,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError("Эта Discord-роль уже настроена как роль инструктора")
    await db.refresh(row)
    return row


async def delete_instructor_role(db: AsyncSession, row: InstructorRole) -> None:
    await db.delete(row)
    await db.commit()
