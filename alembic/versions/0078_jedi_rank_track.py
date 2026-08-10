"""Джедаи: независимый "ранг" (Падаван/Рыцарь/Мастер/Гранд-Мастер) отдельно от
уже существующего "звания" (CO/SCO/GEN/SGEN/HGEN, хранится в User.rank_id).
Звание переезжает в новое поле User.jedi_title_id, чтобы User.rank_id мог
хранить ранг и проходить через обычный авто-промо-пайплайн (баллы/выслуга) —
кроме перехода в Гранд-Мастера, который остаётся полностью ручным и уникальным
на всю систему (см. CLAUDE.md, раздел "Jedi rank track").

Revision ID: 0078
Revises: 0077
Create Date: 2026-08-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0078"
down_revision: Union[str, None] = "0077"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RANG_TIER_NAME = "Джедаи — Ранг"

# code, name, order, jedi_manual_only, ceiling_code (max допустимое звание)
RANGS = [
    ("PDW", "Падаван", 1, False, "SCO"),
    ("KNT", "Рыцарь Джедай", 2, False, "GEN"),
    ("MST", "Мастер Джедай", 3, False, "SGEN"),
    ("GMST", "Гранд-Мастер", 4, True, "HGEN"),
]


def upgrade() -> None:
    op.add_column(
        "rank_tiers", sa.Column("is_jedi_rank_track", sa.Boolean(), nullable=False, server_default="false")
    )
    op.add_column("ranks", sa.Column("jedi_manual_only", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column(
        "ranks", sa.Column("max_jedi_title_rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True)
    )
    op.add_column("users", sa.Column("jedi_title_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True))

    connection = op.get_bind()

    # CO/SCO codes also exist on the regular (non-jedi) "Старший Офицерский
    # состав" tier — must scope to the jedi звание tiers specifically
    title_ids = {
        code: connection.execute(
            sa.text(
                "SELECT r.id FROM ranks r JOIN rank_tiers t ON t.id = r.tier_id "
                "WHERE r.code = :code AND t.is_jedi = true"
            ),
            {"code": code},
        ).scalar_one()
        for code in ("CO", "SCO", "GEN", "SGEN", "HGEN")
    }

    # order=9: regular tiers occupy 1-6 (see 0010_ranks.py), existing jedi
    # звание tiers occupy 7-8 (see 0050_jedi_ranks.py) — ранг sits after both
    tier_id = connection.execute(
        sa.text(
            'INSERT INTO rank_tiers (name, "order", is_jedi, is_jedi_rank_track) '
            "VALUES (:name, 9, true, true) RETURNING id"
        ),
        {"name": RANG_TIER_NAME},
    ).scalar_one()

    gmst_id = None
    for code, name, order, manual_only, ceiling_code in RANGS:
        rank_id = connection.execute(
            sa.text(
                'INSERT INTO ranks (tier_id, code, name, "order", jedi_manual_only, max_jedi_title_rank_id) '
                "VALUES (:tier_id, :code, :name, :order, :manual_only, :ceiling_id) RETURNING id"
            ),
            {
                "tier_id": tier_id,
                "code": code,
                "name": name,
                "order": order,
                "manual_only": manual_only,
                "ceiling_id": title_ids[ceiling_code],
            },
        ).scalar_one()
        if code == "GMST":
            gmst_id = rank_id

    op.create_index(
        "uq_users_single_grand_master",
        "users",
        ["rank_id"],
        unique=True,
        postgresql_where=sa.text(f"rank_id = {gmst_id}"),
    )


def downgrade() -> None:
    op.drop_index("uq_users_single_grand_master", table_name="users")

    connection = op.get_bind()
    tier_id = connection.execute(
        sa.text("SELECT id FROM rank_tiers WHERE name = :name"), {"name": RANG_TIER_NAME}
    ).scalar_one_or_none()
    if tier_id is not None:
        connection.execute(sa.text("DELETE FROM ranks WHERE tier_id = :tier_id"), {"tier_id": tier_id})
        connection.execute(sa.text("DELETE FROM rank_tiers WHERE id = :tier_id"), {"tier_id": tier_id})

    op.drop_column("users", "jedi_title_id")
    op.drop_column("ranks", "max_jedi_title_rank_id")
    op.drop_column("ranks", "jedi_manual_only")
    op.drop_column("rank_tiers", "is_jedi_rank_track")
