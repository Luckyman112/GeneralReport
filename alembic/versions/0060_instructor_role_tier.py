"""Иерархия внутри дисциплины: instructor/deputy/curator у InstructorRole

Revision ID: 0060
Revises: 0059
Create Date: 2026-08-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0060"
down_revision: Union[str, None] = "0059"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "instructor_roles",
        sa.Column("tier", sa.String(length=16), nullable=False, server_default="instructor"),
    )


def downgrade() -> None:
    op.drop_column("instructor_roles", "tier")
