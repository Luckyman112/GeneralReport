"""Разовый перенос регламента повышений RCT..SLT из устава в данные.

- Звания: PVT -> PV1 "Рядовой Новобранец", новое PV2 "Рядовой" после него,
  SSG -> "Старший Сержант". Все, кто был на PVT, остаются на той же строке (PV1).
- Выслуга (значение на звании X = дней на ПРЕДЫДУЩЕМ звании, см.
  rank_crud.effective_tenure_days): рядовой состав 3 дня, сержантский 6,
  младший офицерский 10; RCT -> PV1 без ожидания.
- PFC требует 1 выданную специализацию (Rank.specializations_required).
- Требования по категориям для PV1..SLT заменяются целиком на регламент ниже,
  одинаково во всех формированиях (обязательные, по одной группе на пару
  звание+категория). CPT и выше не трогаются.

Существующим категориям не меняет ни поля, ни "только командир"; две новые
категории (базовое снаряжение, практика командования) создаёт там, где их нет.
Минимальное звание подачи ставится только туда, где сейчас ниже или не задано.

По умолчанию — сухой прогон (ничего не пишет). Применить:
    docker exec -i collapsar-backend python -m scripts.apply_charter_promotions --apply
"""
import asyncio
import sys

from sqlalchemy import delete, func, select

from app.crud import rank as rank_crud
from app.database import async_session_maker
from app.models.promotion import PromotionCategoryRequirement, PromotionRequirementOverride
from app.models.rank import Rank
from app.models.regiment import Regiment
from app.models.report_category import ReportCategory

COVERED_RANKS = ["PV1", "PV2", "PFC", "SPC", "CPL", "SGT", "SSG", "MSG", "SGM", "JLT", "LT", "SLT"]

# звание -> [(категория, сколько, как считать)]
REQUIREMENTS = {
    "PV2": [("Тренировка", 1, "participant"), ("Обучение на базовое снаряжение", 1, "participant"), ("Пост", 1, "any")],
    "PFC": [("Тренировка", 1, "participant"), ("Пост", 1, "any")],
    "SPC": [("Тренировка", 2, "participant"), ("Пост", 1, "any"), ("Лекция на Рядовой состав", 1, "any")],
    "CPL": [("Аттестация на Рядовой состав", 1, "participant"), ("Боевой вылет", 1, "any")],
    "SGT": [("Лекция на Сержантский состав", 1, "participant"), ("Боевой вылет", 1, "author")],
    "SSG": [("Практика командования", 1, "author"), ("Тренировка", 1, "author")],
    "MSG": [("Тренировка", 2, "author"), ("Боевой вылет", 1, "any")],
    "SGM": [("Аттестация на Сержантский состав", 1, "participant"), ("Боевой вылет", 1, "author")],
    "JLT": [("Лекция на Мл.Оф. состав", 1, "participant"), ("Методичка по узкой специализации", 1, "author")],
    "LT": [
        ("Защита ОВО", 1, "author"),
        ("Тренировка", 1, "author"),
        ("Аттестация на Рядовой состав", 1, "author"),
        ("Аттестация на Сержантский состав", 1, "author"),
    ],
    "SLT": [
        ("Методичка по узкой специализации", 2, "author"),
        ("Защита ОВО", 1, "author"),
        ("Лекция на Ст.Оф. состав", 1, "participant"),
    ],
}

TENURE = {"PV1": 0, "PV2": 3, "PFC": 3, "SPC": 3, "CPL": 3, "SGT": 3, "SSG": 6, "MSG": 6, "SGM": 6, "JLT": 6, "LT": 10, "SLT": 10}
SPECIALIZATIONS = {"PFC": 1}

NEW_CATEGORIES = {
    "Обучение на базовое снаряжение": [
        {"name": "Проводящий обучение", "type": "roster", "allowed_regiment_ids": [], "default_self": True},
        {"name": "Обучаемые", "type": "roster", "allowed_regiment_ids": []},
        {"name": "Заметки", "type": "text", "allowed_regiment_ids": []},
    ],
    "Практика командования": [
        {"name": "Командующий (практика)", "type": "roster", "allowed_regiment_ids": [], "default_self": True},
        {"name": "Консультирующий командир/заместитель", "type": "roster", "allowed_regiment_ids": []},
        {"name": "Состав", "type": "roster", "allowed_regiment_ids": []},
        {"name": "Итоги", "type": "text", "allowed_regiment_ids": []},
    ],
}

# категория -> минимальное звание подачи по уставу
MIN_FILING_RANK = {
    "Аттестация на Рядовой состав": "SGT",  # "Проводит SGT+"
    "Лекция на Мл.Оф. состав": "CPT",  # "от клона в звании CPT+"
    "Практика командования": "SGT",
}


async def main(apply: bool) -> None:
    async with async_session_maker() as db:
        ranks = {r.code: r for r in (await db.execute(select(Rank))).scalars().all()}

        # --- звания ---
        if "PV1" not in ranks:
            pvt = ranks["PVT"]
            print(f"PVT -> PV1 «Рядовой Новобранец» (id={pvt.id})")
            pvt.code, pvt.name = "PV1", "Рядовой Новобранец"
            ranks["PV1"] = ranks.pop("PVT")
        pv1 = ranks["PV1"]
        if "PV2" not in ranks:
            tier_ranks = (
                (await db.execute(select(Rank).where(Rank.tier_id == pv1.tier_id).order_by(Rank.order.desc())))
                .scalars()
                .all()
            )
            for r in tier_ranks:
                if r.order > pv1.order:
                    r.order += 1
            await db.flush()
            pv2 = Rank(tier_id=pv1.tier_id, code="PV2", name="Рядовой", order=pv1.order + 1)
            db.add(pv2)
            await db.flush()
            ranks["PV2"] = pv2
            print(f"+ PV2 «Рядовой» (order {pv2.order}), остальные звания состава сдвинуты")
        if ranks["SSG"].name != "Старший Сержант":
            print(f"SSG «{ranks['SSG'].name}» -> «Старший Сержант»")
            ranks["SSG"].name = "Старший Сержант"

        for code, days in TENURE.items():
            if ranks[code].tenure_days_required != days:
                print(f"выслуга {code}: {ranks[code].tenure_days_required} -> {days}")
                ranks[code].tenure_days_required = days
        for code in COVERED_RANKS:
            want = SPECIALIZATIONS.get(code)
            if ranks[code].specializations_required != want:
                print(f"специализаций для {code}: {ranks[code].specializations_required} -> {want}")
                ranks[code].specializations_required = want

        # --- категории ---
        await db.flush()
        position = {r.id: i for i, r in enumerate(await rank_crud.get_all_ranks_ordered(db))}
        regiments = (await db.execute(select(Regiment))).scalars().all()
        categories = {}
        for regiment in regiments:
            for name in {n for reqs in REQUIREMENTS.values() for n, _, _ in reqs}:
                cat = (
                    await db.execute(
                        select(ReportCategory).where(ReportCategory.regiment_id == regiment.id, ReportCategory.name == name)
                    )
                ).scalar_one_or_none()
                if cat is None:
                    if name not in NEW_CATEGORIES:
                        raise SystemExit(f"В «{regiment.name}» нет категории «{name}» — остановлено")
                    cat = ReportCategory(regiment_id=regiment.id, name=name, fields=NEW_CATEGORIES[name])
                    db.add(cat)
                    await db.flush()
                    print(f"+ категория «{name}» в «{regiment.name}»")
                min_code = MIN_FILING_RANK.get(name)
                if min_code:
                    want = ranks[min_code]
                    current = await db.get(Rank, cat.min_rank_id) if cat.min_rank_id else None
                    if current is None or position[current.id] < position[want.id]:
                        print(f"мин. звание «{name}» в «{regiment.name}»: {current.code if current else '—'} -> {min_code}")
                        cat.min_rank_id = want.id
                categories[(regiment.id, name)] = cat

        # --- требования ---
        covered_ids = [ranks[c].id for c in COVERED_RANKS]
        old_ids = (
            (await db.execute(select(PromotionCategoryRequirement.id).where(PromotionCategoryRequirement.rank_id.in_(covered_ids))))
            .scalars()
            .all()
        )
        print(f"удаляю старых требований для PV1..SLT: {len(old_ids)}")
        if old_ids:
            await db.execute(delete(PromotionRequirementOverride).where(PromotionRequirementOverride.requirement_id.in_(old_ids)))
            await db.execute(delete(PromotionCategoryRequirement).where(PromotionCategoryRequirement.id.in_(old_ids)))

        group_id = (await db.execute(select(func.max(PromotionCategoryRequirement.mandatory_group_id)))).scalar() or 0
        created = 0
        for code, reqs in REQUIREMENTS.items():
            for name, count, mode in reqs:
                group_id += 1
                for regiment in regiments:
                    db.add(
                        PromotionCategoryRequirement(
                            regiment_id=regiment.id,
                            rank_id=ranks[code].id,
                            category_id=categories[(regiment.id, name)].id,
                            count_required=count,
                            count_mode=mode,
                            is_mandatory=True,
                            mandatory_group_id=group_id,
                        )
                    )
                    created += 1
                print(f"  {code}: {name} ×{count} ({mode})")
        print(f"создаю требований: {created} ({len(regiments)} формирований)")

        if apply:
            await db.commit()
            print("ПРИМЕНЕНО")
        else:
            await db.rollback()
            print("сухой прогон — ничего не записано (добавьте --apply)")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
