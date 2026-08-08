"""Ивентрум — id отправленного сообщения бота, чтобы дозаполнение редактировало его

Revision ID: 0066
Revises: 0065
Create Date: 2026-08-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0066"
down_revision: Union[str, None] = "0065"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("events", sa.Column("discord_message_id", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "discord_message_id")
