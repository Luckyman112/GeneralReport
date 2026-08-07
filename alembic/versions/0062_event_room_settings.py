"""Ивентрум — Discord-роли Ивентолога/Ассистента/Куратора + канал уведомлений

Revision ID: 0062
Revises: 0061
Create Date: 2026-08-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0062"
down_revision: Union[str, None] = "0061"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("event_role_id", sa.String(length=32), nullable=True))
    op.add_column("app_settings", sa.Column("event_assistant_role_id", sa.String(length=32), nullable=True))
    op.add_column("app_settings", sa.Column("event_curator_role_id", sa.String(length=32), nullable=True))
    op.add_column("app_settings", sa.Column("event_notify_channel_id", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("app_settings", "event_notify_channel_id")
    op.drop_column("app_settings", "event_curator_role_id")
    op.drop_column("app_settings", "event_assistant_role_id")
    op.drop_column("app_settings", "event_role_id")
