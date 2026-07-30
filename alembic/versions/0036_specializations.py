"""Каталог специализаций ВАР + выдача бойцам инструкторами, роль "Инструктор"

Revision ID: 0036
Revises: 0035
Create Date: 2026-07-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0036"
down_revision: Union[str, None] = "0035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Сид-каталог по актуальному списку специализаций ВАР (классы/снаряжение/
# специализации/элитные) — администратор потом сможет дополнить список сам.
SEED_SPECIALIZATIONS = [
    ("MED", "Медик"),
    ("ENG", "Инженер"),
    ("PIL", "Пилот"),
    ("GH", "Крюк Кошка"),
    ("FA", "Набор Первой Помощи"),
    ("GN", "Набор Гранат"),
    ("DM", "Набор Подрывника"),
    ("SK", "Набор Ударника"),
    ("CM", "Набор Коммандоса"),
    ("JT", "Джетпак"),
    ("FLR", "Сигнальные Ракетницы"),
    ("SM", "Штурмовик"),
    ("PR", "Десантник"),
    ("SD", "Щитовик"),
    ("SN", "Снайпер"),
    ("ARF", "Разведчик"),
    ("HEV", "Тяжёлый Боец"),
    ("PRG", "Чистильщик"),
    ("UNV", "Универсал"),
    ("ARC", "ЭРК"),
    ("RC", "РК"),
    ("AG", "Агент"),
    ("GM", "Галактический Пехотинец"),
    ("EVO", "Штурмовик Опасных Сред"),
    ("MRK", "Стрелок"),
    ("SO", "Оперативник"),
    ("PRT", "Преторианец"),
    ("LEG", "Легат"),
    ("MSC", "Мандалорский Суперкоммандос"),
]


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("instructor_role_id", sa.String(32), nullable=True))

    op.create_table(
        "specializations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(16), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
    )
    op.create_table(
        "user_specializations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("specialization_id", sa.Integer(), sa.ForeignKey("specializations.id"), nullable=False),
        sa.Column("granted_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "specialization_id", name="uq_user_specialization"),
    )

    connection = op.get_bind()
    for code, name in SEED_SPECIALIZATIONS:
        connection.execute(
            sa.text("INSERT INTO specializations (code, name) VALUES (:code, :name)"),
            {"code": code, "name": name},
        )


def downgrade() -> None:
    op.drop_table("user_specializations")
    op.drop_table("specializations")
    op.drop_column("app_settings", "instructor_role_id")
