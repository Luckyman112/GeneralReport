"""Системный флаг "Наставничество" — одобрение рапорта отмечает очередное
испытание Падавана сданным (см. app/api/reports.py::_apply_approval_side_effects,
заменяет прежнюю прямую кнопку "Отметить испытание сданным").

Revision ID: 0083
Revises: 0082
Create Date: 2026-08-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0083"
down_revision: Union[str, None] = "0082"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "report_categories",
        sa.Column("is_jedi_trial_report", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("report_categories", "is_jedi_trial_report")
