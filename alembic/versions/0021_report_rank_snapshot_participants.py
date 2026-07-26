"""Звание автора на момент рапорта, баллы участникам (ростер-поля)

Revision ID: 0021
Revises: 0020
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("reports", sa.Column("author_rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True))
    op.add_column(
        "reports",
        sa.Column("participant_discord_ids", postgresql.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column("report_categories", sa.Column("participant_points", sa.Integer(), nullable=True))

    op.create_table(
        "report_participants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("reports.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("report_participants")
    op.drop_column("report_categories", "participant_points")
    op.drop_column("reports", "participant_discord_ids")
    op.drop_column("reports", "author_rank_id")
