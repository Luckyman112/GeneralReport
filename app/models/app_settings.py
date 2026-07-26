from sqlalchemy import JSON, Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppSettings(Base):
    """Singleton-таблица (всегда одна строка id=1).

    admin_role_id/commander_role_id/deputy_role_id — редактируются только через вход
    по паролю (см. app/api/app_settings.py). high_command_role_id и списки для модуля
    "Нарушители"/рассылки/рапорта о задержании — редактируются любым администратором
    (см. app/api/violations.py). Всё это можно менять без правки .env и перезапуска
    сервера."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Конкретные люди с правами администратора (в дополнение к admin_role_id) —
    # позволяет назначить админом того, у кого нет/не хочется давать Discord-роль
    admin_user_discord_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Роль "Основатель" — права полностью равны администратору, но человек заходит
    # под своим собственным Discord-аккаунтом (не общим паролем), поэтому в аудит-логе
    # видно именно его имя, а не обезличенное "Локальный администратор"
    founder_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    commander_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    deputy_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Высшее командование — как командир/зам, но сразу для всех формирований;
    # может выдавать выговоры даже командирам. Не совпадает с is_admin.
    high_command_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Формирования/Discord-роли, чьи участники могут заводить записи о нарушениях
    violation_writer_regiment_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    violation_writer_role_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Формирования/Discord-роли, чьи участники могут просматривать весь список
    # нарушений (помимо этого, список всегда виден командиру/заместителю — своего
    # формирования, см. can_view_violations)
    violation_viewer_regiment_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    violation_viewer_role_ids: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Кто может отправлять объявления всем (помимо администратора)
    broadcast_role_ids: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Кому в разделе "Рапорты" видна кнопка "Рапорт о задержании" — по ролям и/или
    # по конкретным людям
    detention_report_role_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    detention_report_user_discord_ids: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Режим обслуживания — на время миграций/восстановления из бэкапа. Блокирует
    # доступ всем, кроме администратора (см. MaintenanceMiddleware); сообщение
    # показывается в баннере на фронте.
    maintenance_mode: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    maintenance_message: Mapped[str | None] = mapped_column(Text, nullable=True)
