"""Индексы на часто фильтруемые поля (FK-колонки в Postgres не индексируются сами)

Revision ID: 0030
Revises: 0029
Create Date: 2026-08-01

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0030"
down_revision: Union[str, None] = "0029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_reports_regiment_id", "reports", ["regiment_id"])
    op.create_index("ix_reports_category_id", "reports", ["category_id"])
    op.create_index("ix_reports_user_id", "reports", ["user_id"])
    op.create_index("ix_reports_status", "reports", ["status"])
    op.create_index("ix_promotion_requests_status", "promotion_requests", ["status"])
    op.create_index("ix_promotion_requests_regiment_id", "promotion_requests", ["regiment_id"])
    op.create_index("ix_promotion_requests_user_id", "promotion_requests", ["user_id"])
    op.create_index("ix_users_registration_status", "users", ["registration_status"])
    op.create_index("ix_leave_requests_regiment_id", "leave_requests", ["regiment_id"])
    op.create_index("ix_leave_requests_status", "leave_requests", ["status"])
    op.create_index("ix_violations_target_regiment_id", "violations", ["target_regiment_id"])
    op.create_index("ix_reprimands_target_user_id", "reprimands", ["target_user_id"])


def downgrade() -> None:
    op.drop_index("ix_reprimands_target_user_id", table_name="reprimands")
    op.drop_index("ix_violations_target_regiment_id", table_name="violations")
    op.drop_index("ix_leave_requests_status", table_name="leave_requests")
    op.drop_index("ix_leave_requests_regiment_id", table_name="leave_requests")
    op.drop_index("ix_users_registration_status", table_name="users")
    op.drop_index("ix_promotion_requests_user_id", table_name="promotion_requests")
    op.drop_index("ix_promotion_requests_regiment_id", table_name="promotion_requests")
    op.drop_index("ix_promotion_requests_status", table_name="promotion_requests")
    op.drop_index("ix_reports_status", table_name="reports")
    op.drop_index("ix_reports_user_id", table_name="reports")
    op.drop_index("ix_reports_category_id", table_name="reports")
    op.drop_index("ix_reports_regiment_id", table_name="reports")
