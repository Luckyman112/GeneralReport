"""Список конкретных людей с правами администратора (в дополнение к роли)

Revision ID: 0024
Revises: 0023
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: Union[str, None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("admin_user_discord_ids", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "admin_user_discord_ids")
