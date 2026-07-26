"""reprimands, promotion_requirements, promotion_requests + report_categories.is_detention
+ reports target_* fields for detention reports

Revision ID: 0016
Revises: 0015
Create Date: 2026-07-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reprimands",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("target_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("issued_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )

    op.create_table(
        "promotion_requirements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=False),
        sa.Column("points_required", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("regiment_id", "rank_id", name="uq_promotion_requirement"),
    )

    op.create_table(
        "promotion_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("from_rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True),
        sa.Column("to_rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.add_column(
        "report_categories", sa.Column("is_detention", sa.Boolean(), nullable=False, server_default="false")
    )

    op.add_column("reports", sa.Column("target_discord_id", sa.String(length=32), nullable=True))
    op.add_column("reports", sa.Column("target_username", sa.String(length=255), nullable=True))
    op.add_column("reports", sa.Column("target_regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=True))
    op.add_column("reports", sa.Column("target_service_id", sa.String(length=4), nullable=True))
    op.add_column("reports", sa.Column("target_rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True))
    op.add_column("reports", sa.Column("target_callsign", sa.String(length=255), nullable=True))
    op.add_column("reports", sa.Column("violation_id", sa.Integer(), sa.ForeignKey("violations.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("reports", "violation_id")
    op.drop_column("reports", "target_callsign")
    op.drop_column("reports", "target_rank_id")
    op.drop_column("reports", "target_service_id")
    op.drop_column("reports", "target_regiment_id")
    op.drop_column("reports", "target_username")
    op.drop_column("reports", "target_discord_id")

    op.drop_column("report_categories", "is_detention")

    op.drop_table("promotion_requests")
    op.drop_table("promotion_requirements")
    op.drop_table("reprimands")
