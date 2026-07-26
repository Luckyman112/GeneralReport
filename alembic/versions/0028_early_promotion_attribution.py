"""Кто досрочно повысил бойца вручную и причина (в отличие от обычной заявки)

Revision ID: 0028
Revises: 0027
Create Date: 2026-07-30

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: Union[str, None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("early_promoted_by_username", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("early_promotion_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "early_promotion_reason")
    op.drop_column("users", "early_promoted_by_username")
