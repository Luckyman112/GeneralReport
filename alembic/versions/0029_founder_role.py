"""Роль "Основатель" — Discord-роль с правами, равными администратору

Revision ID: 0029
Revises: 0028
Create Date: 2026-07-31

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: Union[str, None] = "0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("founder_role_id", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("app_settings", "founder_role_id")
