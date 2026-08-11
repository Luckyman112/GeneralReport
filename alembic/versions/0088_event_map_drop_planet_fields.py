"""Убрать поля планеты из EventMap — переехали в Event.payload (см. 0089)

Revision ID: 0088
Revises: 0087
Create Date: 2026-08-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0088"
down_revision: Union[str, None] = "0087"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("event_maps", "planet_name")
    op.drop_column("event_maps", "landscape")
    op.drop_column("event_maps", "weather")
    op.drop_column("event_maps", "star_system")


def downgrade() -> None:
    op.add_column("event_maps", sa.Column("star_system", sa.String(length=255), nullable=True))
    op.add_column("event_maps", sa.Column("weather", sa.String(length=255), nullable=True))
    op.add_column("event_maps", sa.Column("landscape", sa.String(length=255), nullable=True))
    op.add_column("event_maps", sa.Column("planet_name", sa.String(length=255), nullable=True))
