"""Режим обслуживания — сайт-уровневый баннер/блокировка на время миграций/бэкапов

Revision ID: 0031
Revises: 0030
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0031"
down_revision: Union[str, None] = "0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "app_settings", sa.Column("maintenance_mode", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column("app_settings", sa.Column("maintenance_message", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("app_settings", "maintenance_message")
    op.drop_column("app_settings", "maintenance_mode")
