"""Зеркалирование рапортов между категориями (обучение рекрутов -> Штаб)

Revision ID: 0072
Revises: 0071
Create Date: 2026-08-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0072"
down_revision: Union[str, None] = "0071"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("report_categories", sa.Column("mirrors_to_category_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_report_categories_mirrors_to_category_id",
        "report_categories",
        "report_categories",
        ["mirrors_to_category_id"],
        ["id"],
    )
    op.add_column("reports", sa.Column("mirror_of_report_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_reports_mirror_of_report_id",
        "reports",
        "reports",
        ["mirror_of_report_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_reports_mirror_of_report_id", "reports", type_="foreignkey")
    op.drop_column("reports", "mirror_of_report_id")
    op.drop_constraint("fk_report_categories_mirrors_to_category_id", "report_categories", type_="foreignkey")
    op.drop_column("report_categories", "mirrors_to_category_id")
