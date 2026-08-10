"""Лимит "не более N рапортов этой категории в день на бойца" (например
"Деятельность специализации" у джедаев — не чаще 2 раз в день).

Revision ID: 0079
Revises: 0078
Create Date: 2026-08-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0079"
down_revision: Union[str, None] = "0078"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("report_categories", sa.Column("max_per_day", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("report_categories", "max_per_day")
