"""Разовый бэкафилл: заводит системные (Задержание/Повышение/Понижение/Обучение на
специализации) и базовые (Тренировка/Пост/Патруль/Боевой вылет/Защита ОВО) категории
рапортов в формированиях, которые были созданы ДО того, как их стало заводить
app/crud/regiment.py::create() автоматически. Пропускает то, что уже есть в
формировании (сверка по имени) — безопасно перезапускать.

Запускать на сервере (после deploy) как модуль:
    docker exec -i collapsar-backend python -m scripts.backfill_base_categories
Локально (из корня проекта, с настроенным .env):
    python -m scripts.backfill_base_categories
"""
import asyncio

from app.crud.regiment import (
    BASE_CATEGORY_SET,
    DEMOTION_CATEGORY_NAME,
    DETENTION_CATEGORY_NAME,
    DETENTION_POINTS,
    PROMOTION_CATEGORY_NAME,
    TRAINING_CATEGORY_NAME,
)
from app.crud import regiment as regiment_crud
from app.crud import report_category as report_category_crud
from app.database import async_session_maker
from app.models.report_category import ReportCategory


async def main() -> None:
    async with async_session_maker() as db:
        regiments = await regiment_crud.get_all(db, include_archived=True)
        for regiment in regiments:
            existing_names = {c.name for c in await report_category_crud.get_by_regiment(db, regiment.id)}
            added = []

            if DETENTION_CATEGORY_NAME not in existing_names:
                db.add(
                    ReportCategory(
                        regiment_id=regiment.id,
                        name=DETENTION_CATEGORY_NAME,
                        fields=[],
                        is_detention=True,
                        points=DETENTION_POINTS,
                    )
                )
                added.append(DETENTION_CATEGORY_NAME)
            if PROMOTION_CATEGORY_NAME not in existing_names:
                db.add(ReportCategory(regiment_id=regiment.id, name=PROMOTION_CATEGORY_NAME, fields=[], is_promotion=True))
                added.append(PROMOTION_CATEGORY_NAME)
            if DEMOTION_CATEGORY_NAME not in existing_names:
                db.add(ReportCategory(regiment_id=regiment.id, name=DEMOTION_CATEGORY_NAME, fields=[], is_demotion=True))
                added.append(DEMOTION_CATEGORY_NAME)
            if TRAINING_CATEGORY_NAME not in existing_names:
                db.add(ReportCategory(regiment_id=regiment.id, name=TRAINING_CATEGORY_NAME, fields=[], is_training=True))
                added.append(TRAINING_CATEGORY_NAME)

            for spec in BASE_CATEGORY_SET:
                if spec["name"] in existing_names:
                    continue
                db.add(
                    ReportCategory(
                        regiment_id=regiment.id,
                        name=spec["name"],
                        fields=spec["fields"],
                        points=spec["points"],
                        participant_points=spec["participant_points"],
                    )
                )
                added.append(spec["name"])

            if added:
                await db.commit()
                print(f"{regiment.name}: добавлено {', '.join(added)}")
            else:
                print(f"{regiment.name}: уже всё есть, пропущено")


if __name__ == "__main__":
    asyncio.run(main())
