"""Рапорт об обучении — несколько специализаций за раз

Revision ID: 0055
Revises: 0054
Create Date: 2026-08-04

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0055"
down_revision: Union[str, None] = "0054"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "reports", sa.Column("training_specialization_ids", sa.JSON(), nullable=False, server_default="[]")
    )
    op.execute(
        """
        UPDATE reports
        SET training_specialization_ids = json_build_array(training_specialization_id)
        WHERE training_specialization_id IS NOT NULL
        """
    )
    op.drop_constraint("reports_training_specialization_id_fkey", "reports", type_="foreignkey")
    op.drop_column("reports", "training_specialization_id")


def downgrade() -> None:
    op.add_column("reports", sa.Column("training_specialization_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "reports_training_specialization_id_fkey", "reports", "specializations", ["training_specialization_id"], ["id"]
    )
    op.execute(
        """
        UPDATE reports
        SET training_specialization_id = (training_specialization_ids->>0)::int
        WHERE json_array_length(training_specialization_ids) > 0
        """
    )
    op.drop_column("reports", "training_specialization_ids")
