"""regiments: возврат к единому Discord-серверу — убираем guild_id и commander_role_id

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("uq_regiments_discord_guild_id", "regiments", type_="unique")
    op.drop_column("regiments", "discord_guild_id")

    op.drop_constraint("regiments_commander_role_id_key", "regiments", type_="unique")
    op.drop_column("regiments", "commander_role_id")

    op.alter_column("regiments", "discord_role_id", nullable=False)


def downgrade() -> None:
    op.alter_column("regiments", "discord_role_id", nullable=True)

    op.add_column("regiments", sa.Column("commander_role_id", sa.String(length=32), nullable=True))
    op.create_unique_constraint("regiments_commander_role_id_key", "regiments", ["commander_role_id"])

    op.add_column(
        "regiments", sa.Column("discord_guild_id", sa.String(length=32), nullable=False, server_default="")
    )
    op.alter_column("regiments", "discord_guild_id", server_default=None)
    op.create_unique_constraint("uq_regiments_discord_guild_id", "regiments", ["discord_guild_id"])
