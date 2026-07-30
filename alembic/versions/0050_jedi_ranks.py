"""Отдельные составы/звания для персонажей-джедаев (см. app/models/character.py) —
собственная иерархия, повышение по которой проходит вручную (голосование
командования), не через автоматическую систему баллов/выслуги этого проекта

Revision ID: 0050
Revises: 0049
Create Date: 2026-07-30

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0050"
down_revision: Union[str, None] = "0049"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TIER_SENIOR = "Джедаи — Старший офицерский состав"
TIER_HIGH = "Джедаи — Высший офицерский состав"


def upgrade() -> None:
    connection = op.get_bind()

    senior_tier_id = connection.execute(
        sa.text(
            "INSERT INTO rank_tiers (name, \"order\") VALUES (:name, 7) RETURNING id"
        ),
        {"name": TIER_SENIOR},
    ).scalar_one()
    high_tier_id = connection.execute(
        sa.text(
            "INSERT INTO rank_tiers (name, \"order\", tenure_days_required) VALUES (:name, 8, 28) RETURNING id"
        ),
        {"name": TIER_HIGH},
    ).scalar_one()

    ranks = [
        (senior_tier_id, "CO", "Джедай Коммандер", 1),
        (senior_tier_id, "SCO", "Старший Джедай Коммандер", 2),
        (high_tier_id, "GEN", "Генерал Джедай", 1),
        (high_tier_id, "SGEN", "Старший Генерал Джедай", 2),
        (high_tier_id, "HGEN", "Высший Генерал Джедай", 3),
    ]
    for tier_id, code, name, order in ranks:
        connection.execute(
            sa.text(
                'INSERT INTO ranks (tier_id, code, name, "order") VALUES (:tier_id, :code, :name, :order)'
            ),
            {"tier_id": tier_id, "code": code, "name": name, "order": order},
        )


def downgrade() -> None:
    connection = op.get_bind()
    tier_ids = connection.execute(
        sa.text("SELECT id FROM rank_tiers WHERE name IN (:senior, :high)"),
        {"senior": TIER_SENIOR, "high": TIER_HIGH},
    ).scalars().all()
    if tier_ids:
        connection.execute(sa.text("DELETE FROM ranks WHERE tier_id = ANY(:tier_ids)"), {"tier_ids": tier_ids})
        connection.execute(sa.text("DELETE FROM rank_tiers WHERE id = ANY(:tier_ids)"), {"tier_ids": tier_ids})
