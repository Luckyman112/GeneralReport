"""Администрация — нон-РП должность (модерация сервера), независимая от
РП-формирований лестница из 5 Discord-ролей + список "ответственных Middle"
(см. app/models/app_settings.py, AccessContext.admin_staff_rank_code/_tier).

Revision ID: 0084
Revises: 0083
Create Date: 2026-08-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0084"
down_revision: Union[str, None] = "0083"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("admin_staff_junior_role_id", sa.String(length=32), nullable=True))
    op.add_column("app_settings", sa.Column("admin_staff_middle_role_id", sa.String(length=32), nullable=True))
    op.add_column("app_settings", sa.Column("admin_staff_warden_role_id", sa.String(length=32), nullable=True))
    op.add_column("app_settings", sa.Column("admin_staff_assistant_role_id", sa.String(length=32), nullable=True))
    op.add_column("app_settings", sa.Column("admin_staff_curator_role_id", sa.String(length=32), nullable=True))
    op.add_column(
        "app_settings",
        sa.Column("admin_staff_responsible_middle_discord_ids", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "admin_staff_responsible_middle_discord_ids")
    op.drop_column("app_settings", "admin_staff_curator_role_id")
    op.drop_column("app_settings", "admin_staff_assistant_role_id")
    op.drop_column("app_settings", "admin_staff_warden_role_id")
    op.drop_column("app_settings", "admin_staff_middle_role_id")
    op.drop_column("app_settings", "admin_staff_junior_role_id")
