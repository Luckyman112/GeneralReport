"""Ивентрум: расширение до 5 ступеней (Младший/Обычный/Старший Ивентолог —
только допуск к подаче, права одобрения остаются только у Ассистента/Куратора,
без изменений). Обычный event_role_id уже существует.

Revision ID: 0086
Revises: 0085
Create Date: 2026-08-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0086"
down_revision: Union[str, None] = "0085"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("event_junior_role_id", sa.String(length=32), nullable=True))
    op.add_column("app_settings", sa.Column("event_senior_role_id", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("app_settings", "event_senior_role_id")
    op.drop_column("app_settings", "event_junior_role_id")
