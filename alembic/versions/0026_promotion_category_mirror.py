"""Системная категория "Повышение" — заявки на повышение дублируются в неё рапортом

Revision ID: 0026
Revises: 0025
Create Date: 2026-07-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: Union[str, None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PROMOTION_CATEGORY_NAME = "Повышение"


def upgrade() -> None:
    op.add_column(
        "report_categories",
        sa.Column("is_promotion", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "promotion_requests",
        sa.Column("mirror_report_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("reports.id"), nullable=True),
    )

    connection = op.get_bind()
    regiment_ids = [row[0] for row in connection.execute(sa.text("SELECT id FROM regiments")).fetchall()]
    for regiment_id in regiment_ids:
        connection.execute(
            sa.text(
                "INSERT INTO report_categories (regiment_id, name, fields, is_promotion) "
                "VALUES (:regiment_id, :name, '[]'::json, true)"
            ),
            {"regiment_id": regiment_id, "name": PROMOTION_CATEGORY_NAME},
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM report_categories WHERE is_promotion = true"))
    op.drop_column("promotion_requests", "mirror_report_id")
    op.drop_column("report_categories", "is_promotion")
