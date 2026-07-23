"""violations: делаем target_discord_id/target_username необязательными + поля
ручного ввода нарушителя (target_service_id, target_rank_id, target_callsign)

Revision ID: 0014
Revises: 0013
Create Date: 2026-07-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("violations", "target_discord_id", existing_type=sa.String(length=32), nullable=True)
    op.alter_column("violations", "target_username", existing_type=sa.String(length=255), nullable=True)

    op.add_column("violations", sa.Column("target_service_id", sa.String(length=4), nullable=True))
    op.add_column("violations", sa.Column("target_rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True))
    op.add_column("violations", sa.Column("target_callsign", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("violations", "target_callsign")
    op.drop_column("violations", "target_rank_id")
    op.drop_column("violations", "target_service_id")

    op.alter_column("violations", "target_username", existing_type=sa.String(length=255), nullable=False)
    op.alter_column("violations", "target_discord_id", existing_type=sa.String(length=32), nullable=False)
