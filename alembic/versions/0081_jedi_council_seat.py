"""Совет Ордена — 4 главы веток (Консулы/Защитники/Стражи/Ученичество), чистый
титул без прав в системе (см. app/models/user.py::jedi_council_seat). Plain
UNIQUE — NULL допускает сколько угодно бойцов без места в Совете, но каждое
из 4 конкретных значений может держать только один боец одновременно.

Revision ID: 0081
Revises: 0080
Create Date: 2026-08-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0081"
down_revision: Union[str, None] = "0080"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("jedi_council_seat", sa.String(length=32), nullable=True))
    op.create_unique_constraint("uq_users_jedi_council_seat", "users", ["jedi_council_seat"])


def downgrade() -> None:
    op.drop_constraint("uq_users_jedi_council_seat", "users", type_="unique")
    op.drop_column("users", "jedi_council_seat")
