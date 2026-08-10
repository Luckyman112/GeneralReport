"""Отчёты Администрации (нон-РП должность) — "Отчёт деятельности" и "Отчёт
наказаний", отдельная сущность от Report/ReportCategory (тот же принцип, что
у Event/Ивентрум — см. app/models/admin_report.py).

Revision ID: 0085
Revises: 0084
Create Date: 2026-08-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0085"
down_revision: Union[str, None] = "0084"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    admin_report_status = sa.Enum("pending", "approved", "rejected", name="admin_report_status")

    op.create_table(
        "admin_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_type", sa.String(length=16), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("status", admin_report_status, nullable=False, server_default="pending"),
        sa.Column("submitted_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("admin_reports")
