from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.jedi_trial import JediTrial

TRIAL_COUNT = 5
# Дней, которые должны пройти ПЕРЕД тем, как испытание N станет доступно —
# считается от даты назначения ранга Падавана (испытание 1) или от даты сдачи
# предыдущего испытания (испытания 2-5). Аттестация на Рыцаря — свой отдельный
# разрыв, GRADUATION_GAP_DAYS, после сдачи испытания 5.
TRIAL_GAP_DAYS = {1: 0, 2: 1, 3: 2, 4: 1, 5: 2}
GRADUATION_GAP_DAYS = 1

_LOAD_OPTIONS = [selectinload(JediTrial.passed_by)]


async def list_for_user(db: AsyncSession, *, user_id: int) -> list[JediTrial]:
    result = await db.execute(
        select(JediTrial).where(JediTrial.user_id == user_id).options(*_LOAD_OPTIONS).order_by(JediTrial.trial_number)
    )
    return list(result.scalars().all())


def next_trial_number(passed: list[JediTrial]) -> int | None:
    """Следующее по порядку неотмеченное испытание (1-5), None если все 5 сданы."""
    passed_numbers = {t.trial_number for t in passed}
    for n in range(1, TRIAL_COUNT + 1):
        if n not in passed_numbers:
            return n
    return None


def earliest_available_at(passed: list[JediTrial], *, padawan_since: datetime | None) -> datetime | None:
    """Когда следующее испытание станет доступно — None, если все сданы или
    не с чего отсчитывать (padawan_since нужен только для испытания 1)."""
    n = next_trial_number(passed)
    if n is None:
        return None
    gap = TRIAL_GAP_DAYS[n]
    if n == 1:
        return (padawan_since + timedelta(days=gap)) if padawan_since else None
    previous = next(t for t in passed if t.trial_number == n - 1)
    return previous.passed_at + timedelta(days=gap)


def graduation_available_at(passed: list[JediTrial]) -> datetime | None:
    """Когда можно аттестовать на Рыцаря — None, если испытание 5 ещё не сдано."""
    last = next((t for t in passed if t.trial_number == TRIAL_COUNT), None)
    if last is None:
        return None
    return last.passed_at + timedelta(days=GRADUATION_GAP_DAYS)


async def mark_passed(db: AsyncSession, *, user_id: int, trial_number: int, passed_by_user_id: int) -> JediTrial:
    row = JediTrial(user_id=user_id, trial_number=trial_number, passed_by_user_id=passed_by_user_id)
    db.add(row)
    await db.commit()
    result = await db.execute(select(JediTrial).where(JediTrial.id == row.id).options(*_LOAD_OPTIONS))
    return result.scalar_one()
