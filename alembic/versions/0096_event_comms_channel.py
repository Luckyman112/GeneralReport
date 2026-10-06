"""Канал для сообщений «на коммуникатор бойцов» (форма миника в Ивентруме).

Revision ID: 0096
Revises: 0095
Create Date: 2026-10-06

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0096"
down_revision: Union[str, None] = "0095"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("event_comms_channel_id", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("app_settings", "event_comms_channel_id")
