"""Целевой боец в журнале действий — для истории изменений профиля в личном деле

Revision ID: 0034
Revises: 0033
Create Date: 2026-07-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: Union[str, None] = "0033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("target_user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_audit_logs_target_user_id", "audit_logs", "users", ["target_user_id"], ["id"]
    )
    op.create_index("ix_audit_logs_target_user_id", "audit_logs", ["target_user_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_target_user_id", table_name="audit_logs")
    op.drop_constraint("fk_audit_logs_target_user_id", "audit_logs", type_="foreignkey")
    op.drop_column("audit_logs", "target_user_id")
