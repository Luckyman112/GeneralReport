"""Карты: ссылка + справка о планете

Revision ID: 0074
Revises: 0073
Create Date: 2026-08-09

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0074"
down_revision: Union[str, None] = "0073"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("event_maps", sa.Column("url", sa.String(length=500), nullable=True))
    op.add_column("event_maps", sa.Column("planet_name", sa.String(length=255), nullable=True))
    op.add_column("event_maps", sa.Column("landscape", sa.String(length=255), nullable=True))
    op.add_column("event_maps", sa.Column("weather", sa.String(length=255), nullable=True))
    op.add_column("event_maps", sa.Column("star_system", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("event_maps", "star_system")
    op.drop_column("event_maps", "weather")
    op.drop_column("event_maps", "landscape")
    op.drop_column("event_maps", "planet_name")
    op.drop_column("event_maps", "url")
