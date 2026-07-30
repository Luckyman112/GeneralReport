"""Доп. фактор для входа по паролю — привязка к конкретному Discord-аккаунту

Revision ID: 0040
Revises: 0039
Create Date: 2026-07-30

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0040"
down_revision: Union[str, None] = "0039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "app_settings", sa.Column("password_login_authorized_discord_id", sa.String(32), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("app_settings", "password_login_authorized_discord_id")
