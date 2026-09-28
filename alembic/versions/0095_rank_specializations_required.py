"""Звание: сколько выданных специализаций нужно иметь для перехода на него
(устав: "PV2-PFC: получение одной специализации подразделения").

Revision ID: 0095
Revises: 0094
Create Date: 2026-09-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0095"
down_revision: Union[str, None] = "0094"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ranks", sa.Column("specializations_required", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("ranks", "specializations_required")
