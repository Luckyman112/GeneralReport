"""Наказание в рапортах/нарушениях, серьёзность выговоров, выслуга на уровне звания,
требования по категориям для повышения (+ оверрайд), отпуска

Revision ID: 0018
Revises: 0017
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("reports", "violations"):
        op.add_column(table, sa.Column("punishment_type", sa.String(length=16), nullable=True))
        op.add_column(table, sa.Column("punishment_other_text", sa.String(length=255), nullable=True))
        op.add_column(table, sa.Column("punishment_amount", sa.String(length=255), nullable=True))

    op.add_column(
        "reprimands", sa.Column("severity", sa.String(length=16), nullable=False, server_default="strict")
    )
    op.add_column(
        "reprimands", sa.Column("points_required", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "reprimands", sa.Column("auto_escalated", sa.Boolean(), nullable=False, server_default="false")
    )

    op.add_column("ranks", sa.Column("tenure_days_required", sa.Integer(), nullable=True))

    op.create_table(
        "promotion_category_requirements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("report_categories.id"), nullable=False),
        sa.Column("count_required", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_mandatory", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("mandatory_group_id", sa.Integer(), nullable=True),
        sa.UniqueConstraint("regiment_id", "rank_id", "category_id", name="uq_promotion_category_requirement"),
    )

    op.create_table(
        "promotion_requirement_overrides",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "requirement_id", sa.Integer(), sa.ForeignKey("promotion_category_requirements.id"), nullable=False
        ),
        sa.Column("satisfied", sa.Boolean(), nullable=False),
        sa.Column("set_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("set_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "requirement_id", name="uq_promotion_requirement_override"),
    )

    op.create_table(
        "leave_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("leave_requests")
    op.drop_table("promotion_requirement_overrides")
    op.drop_table("promotion_category_requirements")
    op.drop_column("ranks", "tenure_days_required")
    op.drop_column("reprimands", "auto_escalated")
    op.drop_column("reprimands", "points_required")
    op.drop_column("reprimands", "severity")
    for table in ("reports", "violations"):
        op.drop_column(table, "punishment_amount")
        op.drop_column(table, "punishment_other_text")
        op.drop_column(table, "punishment_type")
