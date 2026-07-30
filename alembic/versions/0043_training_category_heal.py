"""Переименование категории "Обучение" -> "Обучение на специализации" и
восстановление её для формирований, где её удалили вручную (раньше удаление
категорий "Понижение"/"Обучение" не было заблокировано ни на бэкенде, ни на
фронте — баг, из-за которого рапорт об обучении переставал работать для такого
формирования)

Revision ID: 0043
Revises: 0042
Create Date: 2026-07-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0043"
down_revision: Union[str, None] = "0042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_NAME = "Обучение"
NEW_NAME = "Обучение на специализации"


def upgrade() -> None:
    connection = op.get_bind()

    connection.execute(
        sa.text("UPDATE report_categories SET name = :new_name WHERE is_training = true AND name = :old_name"),
        {"new_name": NEW_NAME, "old_name": OLD_NAME},
    )

    regiment_ids = [row[0] for row in connection.execute(sa.text("SELECT id FROM regiments")).fetchall()]
    missing_ids = [
        regiment_id
        for regiment_id in regiment_ids
        if connection.execute(
            sa.text("SELECT 1 FROM report_categories WHERE regiment_id = :regiment_id AND is_training = true"),
            {"regiment_id": regiment_id},
        ).first()
        is None
    ]
    for regiment_id in missing_ids:
        connection.execute(
            sa.text(
                "INSERT INTO report_categories (regiment_id, name, fields, is_training) "
                "VALUES (:regiment_id, :name, '[]'::json, true)"
            ),
            {"regiment_id": regiment_id, "name": NEW_NAME},
        )


def downgrade() -> None:
    op.execute(sa.text(f"UPDATE report_categories SET name = '{OLD_NAME}' WHERE is_training = true"))
