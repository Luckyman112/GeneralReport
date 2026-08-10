"""Пять испытаний Падавана — трекинг прохождения по датам, с обязательным
разрывом по дням между этапами (см. app/crud/jedi_trial.py::TRIAL_GAP_DAYS).

Revision ID: 0080
Revises: 0079
Create Date: 2026-08-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0080"
down_revision: Union[str, None] = "0079"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "jedi_trials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("trial_number", sa.Integer(), nullable=False),
        sa.Column("passed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("passed_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.UniqueConstraint("user_id", "trial_number", name="uq_jedi_trial_user_number"),
    )


def downgrade() -> None:
    op.drop_table("jedi_trials")
