"""Регистрация нового бойца (ИДН/позывной, звание RCT по умолчанию, одобрение зам+)

Revision ID: 0027
Revises: 0026
Create Date: 2026-07-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("registration_status", sa.String(16), nullable=False, server_default="pending"),
    )
    # Уже существующие на момент этой миграции пользователи — действующие участники,
    # регистрацию проходить заново не должны; "pending" остаётся дефолтом только для
    # новых строк, создаваемых после этой миграции
    op.execute(sa.text("UPDATE users SET registration_status = 'approved'"))


def downgrade() -> None:
    op.drop_column("users", "registration_status")
