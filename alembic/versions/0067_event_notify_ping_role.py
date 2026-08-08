"""Ивентрум — роль, которую бот пингует в уведомлении об одобренном ивенте

Revision ID: 0067
Revises: 0066
Create Date: 2026-08-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0067"
down_revision: Union[str, None] = "0066"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("event_notify_ping_role_id", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("app_settings", "event_notify_ping_role_id")
