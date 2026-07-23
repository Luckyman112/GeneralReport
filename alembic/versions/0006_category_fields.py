"""report_categories.fields — настраиваемые поля рапорта по категории

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "report_categories",
        sa.Column("fields", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.alter_column("report_categories", "fields", server_default=None)


def downgrade() -> None:
    op.drop_column("report_categories", "fields")
