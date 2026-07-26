"""Steam ID — собирается при регистрации, показывается в личном деле

Revision ID: 0032
Revises: 0031
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0032"
down_revision: Union[str, None] = "0031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("steam_id", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "steam_id")
