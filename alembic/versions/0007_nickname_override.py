"""users.nickname_override — веб-ник, задаваемый командиром

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("nickname_override", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "nickname_override")
