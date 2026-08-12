"""Заявка на свободное сообщение по одобренному ивенту — автор пишет текст,
Ассистент+/Куратор одобряет/отклоняет, после одобрения появляется кнопка
"Отправить" (автору и Ассистенту+, см. решение пользователя). Заменяет
прежний прямой POST /event-room/{id}/message без одобрения.

Revision ID: 0091
Revises: 0090
Create Date: 2026-08-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0091"
down_revision: Union[str, None] = "0090"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    status = sa.Enum("pending", "approved", "rejected", name="event_message_status")
    op.create_table(
        "event_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", status, nullable=False, server_default="pending"),
        sa.Column("submitted_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("event_messages")
    op.execute("DROP TYPE event_message_status")
