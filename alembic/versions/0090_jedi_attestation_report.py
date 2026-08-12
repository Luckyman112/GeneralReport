"""Системный флаг "Аттестация" — одобрение рапорта отмечает 6-е испытание
(саму аттестацию) сданным и сразу меняет ранг падавана на Рыцаря (см.
app/api/reports.py::_apply_approval_side_effects, app/crud/jedi_trial.py —
TRIAL_COUNT 5 -> 6).

Revision ID: 0090
Revises: 0089
Create Date: 2026-08-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0090"
down_revision: Union[str, None] = "0089"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "report_categories",
        sa.Column("is_jedi_attestation_report", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("report_categories", "is_jedi_attestation_report")
