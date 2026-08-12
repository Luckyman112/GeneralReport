"""Выговоры Администрации — параллельная reprimands (РП-формирования) таблица,
без regiment_id (Администрация не привязана к формированию) и без
auto-эскалации/points_required (см. решение пользователя, п.7).

Revision ID: 0092
Revises: 0091
Create Date: 2026-08-12

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0092"
down_revision: Union[str, None] = "0091"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_reprimands",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("target_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False, server_default="strict"),
        sa.Column("issued_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("admin_reprimands")
