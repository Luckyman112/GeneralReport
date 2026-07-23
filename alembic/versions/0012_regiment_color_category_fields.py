"""regiments.color + report_categories.fields становится списком объектов {name, type}

Revision ID: 0012
Revises: 0011
Create Date: 2026-07-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


report_categories = sa.table(
    "report_categories",
    sa.column("id", sa.Integer),
    sa.column("fields", postgresql.JSON),
)


def upgrade() -> None:
    op.add_column("regiments", sa.Column("color", sa.String(length=7), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(sa.select(report_categories.c.id, report_categories.c.fields)).fetchall()
    for row in rows:
        old_fields = row.fields or []
        # Уже могло быть в новом формате (на случай повторного прогона) — не трогаем
        if old_fields and isinstance(old_fields[0], dict):
            continue
        new_fields = [{"name": f, "type": "text"} for f in old_fields]
        conn.execute(
            report_categories.update().where(report_categories.c.id == row.id).values(fields=new_fields)
        )


def downgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.select(report_categories.c.id, report_categories.c.fields)).fetchall()
    for row in rows:
        new_fields = row.fields or []
        if not new_fields or not isinstance(new_fields[0], dict):
            continue
        old_fields = [f["name"] for f in new_fields]
        conn.execute(
            report_categories.update().where(report_categories.c.id == row.id).values(fields=old_fields)
        )

    op.drop_column("regiments", "color")
