"""Ивентрум: три типа заявок (ивент / РП ивент / миник), возврат на редакцию,
ручная отправка в Discord после одобрения.

Revision ID: 0097
Revises: 0096
Create Date: 2026-10-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0097"
down_revision: Union[str, None] = "0096"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE нельзя выполнять внутри транзакции
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'revision'")
    op.add_column("events", sa.Column("kind", sa.String(16), nullable=False, server_default="event"))
    op.add_column("events", sa.Column("revision_comment", sa.Text(), nullable=True))
    op.add_column("events", sa.Column("sent_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    op.add_column("events", sa.Column("discord_channel_id", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "discord_channel_id")
    op.drop_column("events", "sent_by_user_id")
    op.drop_column("events", "revision_comment")
    op.drop_column("events", "kind")
    # значение 'revision' из enum Postgres штатно не удаляется — оставляем
