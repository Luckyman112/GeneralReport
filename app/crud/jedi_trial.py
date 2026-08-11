from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.jedi_trial import JediTrial

TRIAL_COUNT = 6
# Дней, которые должны пройти ПЕРЕД тем, как испытание N станет доступно —
# считается от даты назначения ранга Падавана (испытание 1) или от даты сдачи
# предыдущего испытания (испытания 2-6). 6-е испытание — сама аттестация на
# Рыцаря (см. решение пользователя: одна и та же механика JediTrial, не
# отдельная сущность); GRADUATION_GAP_DAYS — тот же разрыв, что раньше
# считала отдельная функция graduation_available_at (удалена, см. ниже
# earliest_available_at теперь покрывает и этот случай).
GRADUATION_GAP_DAYS = 1
TRIAL_GAP_DAYS = {1: 0, 2: 1, 3: 2, 4: 1, 5: 2, 6: GRADUATION_GAP_DAYS}

_LOAD_OPTIONS = [selectinload(JediTrial.passed_by)]


async def list_for_user(db: AsyncSession, *, user_id: int) -> list[JediTrial]:
    result = await db.execute(
        select(JediTrial).where(JediTrial.user_id == user_id).options(*_LOAD_OPTIONS).order_by(JediTrial.trial_number)
    )
    return list(result.scalars().all())


def next_trial_number(passed: list[JediTrial]) -> int | None:
    """Следующее по порядку неотмеченное испытание (1-6, где 6 — аттестация),
    None если все 6 сданы."""
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


async def has_trained_a_padawan(db: AsyncSession, *, user_id: int) -> bool:
    """Для условия "обучить хотя бы одного падавана" на переход в Мастера (см.
    решение пользователя) — наставник ведёт испытания 1-5 ("Наставничество"),
    аттестация (6) — отдельный рапорт и не обязательно у того же наставника
    (см. is_jedi_attestation_report), поэтому "обучил" по-прежнему значит
    "довёл падавана до 5-го испытания включительно" — намеренно захардкожено
    5, не TRIAL_COUNT (тот теперь 6, см. app/api/reports.py)."""
    result = await db.execute(
        select(JediTrial.id).where(JediTrial.passed_by_user_id == user_id, JediTrial.trial_number == 5)
    )
    return result.first() is not None


async def mark_passed(db: AsyncSession, *, user_id: int, trial_number: int, passed_by_user_id: int) -> JediTrial:
    row = JediTrial(user_id=user_id, trial_number=trial_number, passed_by_user_id=passed_by_user_id)
    db.add(row)
    await db.commit()
    result = await db.execute(select(JediTrial).where(JediTrial.id == row.id).options(*_LOAD_OPTIONS))
    return result.scalar_one()
