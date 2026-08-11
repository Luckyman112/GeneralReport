"""Отмена уже одобренной заявки на ивент — новый статус CANCELLED (отдельно
от REJECTED, чтобы отличать "не одобрили" от "одобрили, потом отменили", см.
решение пользователя) + поля кто/когда/почему отменил.

Revision ID: 0089
Revises: 0088
Create Date: 2026-08-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0089"
down_revision: Union[str, None] = "0088"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'cancelled'")
    op.add_column("events", sa.Column("cancelled_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    op.add_column("events", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("events", sa.Column("cancellation_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "cancellation_reason")
    op.drop_column("events", "cancelled_at")
    op.drop_column("events", "cancelled_by_user_id")
    # Postgres не поддерживает удаление значения enum — пересоздаём тип без
    # 'cancelled' (упадёт, если в таблице остались строки с этим статусом —
    # приемлемо для downgrade-пути, см. тот же уровень строгости в 0088)
    op.execute("ALTER TABLE events ALTER COLUMN status TYPE varchar USING status::varchar")
    op.execute("DROP TYPE event_status")
    op.execute("CREATE TYPE event_status AS ENUM ('pending', 'approved', 'rejected')")
    op.execute("ALTER TABLE events ALTER COLUMN status TYPE event_status USING status::event_status")
