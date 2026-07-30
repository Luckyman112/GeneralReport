"""Системная категория "Понижение" — ручное снижение звания дублируется в неё рапортом

Revision ID: 0035
Revises: 0034
Create Date: 2026-07-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0035"
down_revision: Union[str, None] = "0034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEMOTION_CATEGORY_NAME = "Понижение"


def upgrade() -> None:
    op.add_column(
        "report_categories",
        sa.Column("is_demotion", sa.Boolean(), nullable=False, server_default="false"),
    )

    connection = op.get_bind()
    regiment_ids = [row[0] for row in connection.execute(sa.text("SELECT id FROM regiments")).fetchall()]
    for regiment_id in regiment_ids:
        connection.execute(
            sa.text(
                "INSERT INTO report_categories (regiment_id, name, fields, is_demotion) "
                "VALUES (:regiment_id, :name, '[]'::json, true)"
            ),
            {"regiment_id": regiment_id, "name": DEMOTION_CATEGORY_NAME},
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM report_categories WHERE is_demotion = true"))
    op.drop_column("report_categories", "is_demotion")
