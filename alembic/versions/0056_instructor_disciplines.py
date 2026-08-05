"""Дисциплины инструкторов (Медик/Пилот/Инженер + универсальный) — иерархия
подспециализаций, требование по формированию у специализации, обязательная
специализация для подачи рапорта

Revision ID: 0056
Revises: 0055
Create Date: 2026-08-05

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0056"
down_revision: Union[str, None] = "0055"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Specialization: доп. требование по формированию + родитель (подспециализация)
    op.add_column("specializations", sa.Column("required_regiment_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_specializations_required_regiment_id_regiments",
        "specializations",
        "regiments",
        ["required_regiment_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("specializations", sa.Column("parent_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_specializations_parent_id_specializations",
        "specializations",
        "specializations",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # RankTier: лимиты по новым дисциплинам, как у остальных категорий
    op.add_column("rank_tiers", sa.Column("medic_limit", sa.Integer(), nullable=True))
    op.add_column("rank_tiers", sa.Column("pilot_limit", sa.Integer(), nullable=True))
    op.add_column("rank_tiers", sa.Column("engineer_limit", sa.Integer(), nullable=True))

    # InstructorRole: Discord-роль -> какие дисциплины разрешено выдавать
    op.create_table(
        "instructor_roles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("discord_role_id", sa.String(length=32), nullable=False, unique=True),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("discipline", sa.String(length=32), nullable=True),
        sa.Column("can_teach_all", sa.Boolean(), nullable=False, server_default="false"),
    )

    # ReportCategory: обязательная специализация для подачи (напр. "Медицинский
    # рапорт" -> базовый класс "Медик")
    op.add_column("report_categories", sa.Column("required_specialization_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_report_categories_required_specialization_id_specializations",
        "report_categories",
        "specializations",
        ["required_specialization_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_report_categories_required_specialization_id_specializations", "report_categories", type_="foreignkey"
    )
    op.drop_column("report_categories", "required_specialization_id")

    op.drop_table("instructor_roles")

    op.drop_column("rank_tiers", "engineer_limit")
    op.drop_column("rank_tiers", "pilot_limit")
    op.drop_column("rank_tiers", "medic_limit")

    op.drop_constraint("fk_specializations_parent_id_specializations", "specializations", type_="foreignkey")
    op.drop_column("specializations", "parent_id")
    op.drop_constraint(
        "fk_specializations_required_regiment_id_regiments", "specializations", type_="foreignkey"
    )
    op.drop_column("specializations", "required_regiment_id")
