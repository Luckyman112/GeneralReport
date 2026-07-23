"""rank_tiers, ranks + users profile fields (service_id, callsign, rank)

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (название состава, требование по выслуге в днях в предыдущем составе, [(код, название), ...])
TIERS = [
    ("Кадетский корпус", None, [("RCT", "Рекрут")]),
    ("Рядовой состав", None, [
        ("PVT", "Рядовой"),
        ("PFC", "Рядовой Первого Класса"),
        ("SPC", "Специалист"),
        ("CPL", "Капрал"),
    ]),
    ("Сержантский состав", 7, [
        ("SGT", "Сержант"),
        ("SSG", "Штаб Сержант"),
        ("MSG", "Мастер Сержант"),
        ("SGM", "Сержант Майор"),
    ]),
    ("Младший офицерский состав", 14, [
        ("JLT", "Младший Лейтенант"),
        ("LT", "Лейтенант"),
        ("SLT", "Старший Лейтенант"),
        ("CPT", "Капитан"),
    ]),
    ("Старший Офицерский состав", 21, [
        ("MAJ", "Майор"),
        ("LTC", "Подполковник"),
        ("CO", "Коммандер"),
        ("COL", "Полковник"),
        ("SCO", "Старший Коммандер"),
    ]),
    ("Высший Офицерский состав", 28, [("MC", "Маршал Коммандер")]),
]


def upgrade() -> None:
    rank_tiers = op.create_table(
        "rank_tiers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("tenure_days_required", sa.Integer(), nullable=True),
    )
    ranks = op.create_table(
        "ranks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tier_id", sa.Integer(), sa.ForeignKey("rank_tiers.id"), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
    )

    for tier_order, (tier_name, tenure_days, tier_ranks) in enumerate(TIERS, start=1):
        result = op.get_bind().execute(
            rank_tiers.insert().values(name=tier_name, order=tier_order, tenure_days_required=tenure_days)
        )
        tier_id = result.inserted_primary_key[0]
        for rank_order, (code, name) in enumerate(tier_ranks, start=1):
            op.get_bind().execute(
                ranks.insert().values(tier_id=tier_id, code=code, name=name, order=rank_order)
            )

    op.add_column("users", sa.Column("service_id", sa.String(length=4), nullable=True))
    op.add_column("users", sa.Column("callsign", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True))
    op.add_column("users", sa.Column("rank_assigned_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "rank_assigned_at")
    op.drop_column("users", "rank_id")
    op.drop_column("users", "callsign")
    op.drop_column("users", "service_id")
    op.drop_table("ranks")
    op.drop_table("rank_tiers")
