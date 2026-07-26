"""Ссылка на Discord-канал формирования — для инфо-панели формирования

Revision ID: 0033
Revises: 0032
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0033"
down_revision: Union[str, None] = "0032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("regiments", sa.Column("discord_channel_url", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("regiments", "discord_channel_url")
