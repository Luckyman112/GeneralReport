"""Таблица specialization_prerequisites — "нужны ВСЕ из" для ступени "Старший"

Revision ID: 0077
Revises: 0076
Create Date: 2026-08-09

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0077"
down_revision: Union[str, None] = "0076"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "specialization_prerequisites",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("specialization_id", sa.Integer(), sa.ForeignKey("specializations.id"), nullable=False),
        sa.Column("required_specialization_id", sa.Integer(), sa.ForeignKey("specializations.id"), nullable=False),
        sa.UniqueConstraint(
            "specialization_id", "required_specialization_id", name="uq_specialization_prerequisite"
        ),
    )


def downgrade() -> None:
    op.drop_table("specialization_prerequisites")
