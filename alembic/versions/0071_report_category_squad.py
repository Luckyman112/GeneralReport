"""Категория рапорта может требовать членство в отряде

Revision ID: 0071
Revises: 0070
Create Date: 2026-08-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0071"
down_revision: Union[str, None] = "0070"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("report_categories", sa.Column("required_squad_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_report_categories_required_squad_id",
        "report_categories",
        "squads",
        ["required_squad_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_report_categories_required_squad_id", "report_categories", type_="foreignkey")
    op.drop_column("report_categories", "required_squad_id")
