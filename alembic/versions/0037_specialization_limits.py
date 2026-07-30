"""Категории специализаций + лимиты на обучение по составу + временный запрет
на обучение

Revision ID: 0037
Revises: 0036
Create Date: 2026-07-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0037"
down_revision: Union[str, None] = "0036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CATEGORY_BY_CODE = {
    "MED": "class", "ENG": "class", "PIL": "class",
    "GH": "gear", "FA": "gear", "GN": "gear", "DM": "gear", "SK": "gear", "CM": "gear", "JT": "gear", "FLR": "gear",
    "SM": "specialization", "PR": "specialization", "SD": "specialization", "SN": "specialization",
    "ARF": "additional_specialization", "HEV": "additional_specialization", "PRG": "additional_specialization",
    "UNV": "additional_specialization", "MRK": "additional_specialization",
    "ARC": "elite_specialization", "RC": "elite_specialization", "AG": "elite_specialization",
    "GM": "elite_specialization", "EVO": "elite_specialization", "SO": "elite_specialization",
    "PRT": "elite_specialization", "LEG": "elite_specialization", "MSC": "elite_specialization",
}


def upgrade() -> None:
    op.add_column(
        "specializations",
        sa.Column("category", sa.String(32), nullable=False, server_default="specialization"),
    )
    connection = op.get_bind()
    for code, category in CATEGORY_BY_CODE.items():
        connection.execute(
            sa.text("UPDATE specializations SET category = :category WHERE code = :code"),
            {"category": category, "code": code},
        )

    for column in (
        "class_limit",
        "gear_limit",
        "specialization_limit",
        "additional_specialization_limit",
        "elite_specialization_limit",
    ):
        op.add_column("rank_tiers", sa.Column(column, sa.Integer(), nullable=True))

    op.create_table(
        "specialization_bans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        # NULL — запрет на любое обучение вообще, не только на эту специализацию
        sa.Column("specialization_id", sa.Integer(), sa.ForeignKey("specializations.id"), nullable=True),
        sa.Column("until_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_specialization_bans_user_id", "specialization_bans", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_specialization_bans_user_id", table_name="specialization_bans")
    op.drop_table("specialization_bans")
    for column in (
        "class_limit",
        "gear_limit",
        "specialization_limit",
        "additional_specialization_limit",
        "elite_specialization_limit",
    ):
        op.drop_column("rank_tiers", column)
    op.drop_column("specializations", "category")
