"""Личные уведомления (target_user_id), апелляция к выговору, журнал действий
администратора, индексы по created_at

Revision ID: 0020
Revises: 0019
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("target_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    op.add_column("reprimands", sa.Column("appeal_text", sa.Text(), nullable=True))

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("details", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_index("ix_reports_created_at", "reports", ["created_at"])
    op.create_index("ix_violations_created_at", "violations", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_violations_created_at", table_name="violations")
    op.drop_index("ix_reports_created_at", table_name="reports")
    op.drop_table("audit_logs")
    op.drop_column("reprimands", "appeal_text")
    op.drop_column("notifications", "target_user_id")
