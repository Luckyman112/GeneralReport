"""Требование к повышению по категории: как засчитывать рапорт — провёл сам
(author), участвовал (participant) или любое (any). Существующие требования
остаются "author" — прежнее поведение.

Revision ID: 0094
Revises: 0093
Create Date: 2026-09-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0094"
down_revision: Union[str, None] = "0093"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "promotion_category_requirements",
        sa.Column("count_mode", sa.String(16), nullable=False, server_default="author"),
    )


def downgrade() -> None:
    op.drop_column("promotion_category_requirements", "count_mode")
