"""Специализация-исключение, которую может держать только один боец сразу
(например стойка меча "Ваапад" у джедаев) — см.
app/api/specializations.py::_check_can_grant.

Revision ID: 0082
Revises: 0081
Create Date: 2026-08-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0082"
down_revision: Union[str, None] = "0081"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "specializations", sa.Column("is_singleton", sa.Boolean(), nullable=False, server_default="false")
    )


def downgrade() -> None:
    op.drop_column("specializations", "is_singleton")
