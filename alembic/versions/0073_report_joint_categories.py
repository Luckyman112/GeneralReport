"""Совместные категории — независимое одобрение по формированиям-участникам

Revision ID: 0073
Revises: 0072
Create Date: 2026-08-09

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0073"
down_revision: Union[str, None] = "0072"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "report_categories",
        sa.Column("is_joint", sa.Boolean(), nullable=False, server_default="false"),
    )

    decision_status = sa.Enum("pending", "approved", "rejected", name="report_regiment_decision_status")

    op.create_table(
        "report_regiment_decisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("reports.id"), nullable=False),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("status", decision_status, nullable=False, server_default="pending"),
        sa.Column("decided_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("mirror_report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("reports.id"), nullable=True),
        sa.UniqueConstraint("report_id", "regiment_id", name="uq_report_regiment_decision"),
    )


def downgrade() -> None:
    op.drop_table("report_regiment_decisions")
    op.drop_column("report_categories", "is_joint")
