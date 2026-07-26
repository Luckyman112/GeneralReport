"""Backfill: каждому формированию без категории is_detention заводим "Задержание"

Revision ID: 0017
Revises: 0016
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

regiments_table = sa.table("regiments", sa.column("id", sa.Integer))
categories_table = sa.table(
    "report_categories",
    sa.column("id", sa.Integer),
    sa.column("regiment_id", sa.Integer),
    sa.column("name", sa.String),
    sa.column("fields", sa.JSON),
    sa.column("is_detention", sa.Boolean),
)


def upgrade() -> None:
    conn = op.get_bind()
    regiment_ids = [row[0] for row in conn.execute(sa.select(regiments_table.c.id)).fetchall()]
    regiments_with_detention = {
        row[0]
        for row in conn.execute(
            sa.select(categories_table.c.regiment_id).where(categories_table.c.is_detention.is_(True))
        ).fetchall()
    }
    for regiment_id in regiment_ids:
        if regiment_id in regiments_with_detention:
            continue
        conn.execute(
            categories_table.insert().values(
                regiment_id=regiment_id, name="Задержание", fields=[], is_detention=True
            )
        )


def downgrade() -> None:
    pass
