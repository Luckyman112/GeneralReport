"""regiments: привязка к Discord-серверу, роли становятся опциональными

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "regiments",
        sa.Column("discord_guild_id", sa.String(length=32), nullable=False, server_default=""),
    )
    op.alter_column("regiments", "discord_guild_id", server_default=None)
    op.create_unique_constraint("uq_regiments_discord_guild_id", "regiments", ["discord_guild_id"])

    op.alter_column("regiments", "discord_role_id", nullable=True)
    op.alter_column("regiments", "commander_role_id", nullable=True)


def downgrade() -> None:
    op.alter_column("regiments", "commander_role_id", nullable=False)
    op.alter_column("regiments", "discord_role_id", nullable=False)
    op.drop_constraint("uq_regiments_discord_guild_id", "regiments", type_="unique")
    op.drop_column("regiments", "discord_guild_id")
