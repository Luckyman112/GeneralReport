"""Системная категория "Обучение" — рапорт инструктора об обучении специализации,
при одобрении специализация выдаётся автоматически

Revision ID: 0039
Revises: 0038
Create Date: 2026-07-30

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0039"
down_revision: Union[str, None] = "0038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TRAINING_CATEGORY_NAME = "Обучение"


def upgrade() -> None:
    op.add_column(
        "report_categories",
        sa.Column("is_training", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "reports",
        sa.Column("training_specialization_id", sa.Integer(), sa.ForeignKey("specializations.id"), nullable=True),
    )

    connection = op.get_bind()
    regiment_ids = [row[0] for row in connection.execute(sa.text("SELECT id FROM regiments")).fetchall()]
    for regiment_id in regiment_ids:
        connection.execute(
            sa.text(
                "INSERT INTO report_categories (regiment_id, name, fields, is_training) "
                "VALUES (:regiment_id, :name, '[]'::json, true)"
            ),
            {"regiment_id": regiment_id, "name": TRAINING_CATEGORY_NAME},
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM report_categories WHERE is_training = true"))
    op.drop_column("reports", "training_specialization_id")
    op.drop_column("report_categories", "is_training")
