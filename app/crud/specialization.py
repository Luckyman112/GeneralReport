from datetime import date

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import AppError
from app.models.specialization import Specialization, SpecializationBan, UserSpecialization
from app.models.user import User

_GRANT_LOAD_OPTIONS = [
    selectinload(UserSpecialization.specialization),
    selectinload(UserSpecialization.granted_by).selectinload(User.rank),
]
_BAN_LOAD_OPTIONS = [
    selectinload(SpecializationBan.specialization),
    selectinload(SpecializationBan.created_by).selectinload(User.rank),
]


async def count_grants_by_instructor(db: AsyncSession) -> list[tuple[int, int]]:
    """Возвращает [(granted_by_user_id, count), ...] — сколько специализаций выдал
    каждый инструктор/админ, для дашборда активности."""
    result = await db.execute(
        select(UserSpecialization.granted_by_user_id, func.count(UserSpecialization.id)).group_by(
            UserSpecialization.granted_by_user_id
        )
    )
    return list(result.all())


async def get_all(db: AsyncSession) -> list[Specialization]:
    result = await db.execute(
        select(Specialization).options(selectinload(Specialization.min_rank)).order_by(Specialization.name)
    )
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, specialization_id: int) -> Specialization | None:
    return await db.get(Specialization, specialization_id, options=[selectinload(Specialization.min_rank)])


async def create(
    db: AsyncSession, *, code: str, name: str, category: str, min_rank_id: int | None = None
) -> Specialization:
    specialization = Specialization(code=code, name=name, category=category, min_rank_id=min_rank_id)
    db.add(specialization)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(f"Специализация с кодом «{code}» уже существует")
    await db.refresh(specialization, attribute_names=["min_rank"])
    return specialization


async def update(db: AsyncSession, specialization: Specialization, **changes) -> Specialization:
    """changes — только реально переданные клиентом поля (exclude_unset в
    эндпоинте), поэтому min_rank_id: None здесь означает явную очистку, а не
    "не трогать"."""
    for key, value in changes.items():
        setattr(specialization, key, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(f"Специализация с кодом «{changes.get('code', specialization.code)}» уже существует")
    await db.refresh(specialization, attribute_names=["min_rank"])
    return specialization


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
