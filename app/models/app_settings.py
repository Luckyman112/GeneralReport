from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, String, Text
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
    # Конкретные люди с правами Основателя (в дополнение к founder_role_id) —
    # как admin_user_discord_ids, но для Основателя: не у всех обязательно
    # заводить отдельную Discord-роль ради одного человека
    founder_user_discord_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    commander_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    deputy_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Высшее командование — как командир/зам, но сразу для всех формирований;
    # может выдавать выговоры даже командирам. Не совпадает с is_admin.
    high_command_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # can grant/revoke specializations, unrelated to command roles
    instructor_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # if set, password login also requires a valid JWT for this discord account
    password_login_authorized_discord_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

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

    # view-only access to training reports, separate from who can grant them
    training_viewer_role_ids: Mapped[list[str]] = mapped_column(JSON, default=list)

    # regiments whose members count as mentor candidates elsewhere, admin-set
    mentor_source_regiment_ids: Mapped[list[int]] = mapped_column(JSON, default=list)

    # extends can_appeal_report beyond commander/deputy/mentor/admin
    report_appeal_regiment_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    report_appeal_role_ids: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Режим обслуживания — на время миграций/восстановления из бэкапа. Блокирует
    # доступ всем, кроме администратора (см. MaintenanceMiddleware); сообщение
    # показывается в баннере на фронте.
    maintenance_mode: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    maintenance_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # tokens issued before this are rejected, even if still validly signed
    sessions_revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Ивентрум — независимая от INS/DEP/CU ролевая система: Ивентолог подаёт заявку
    # на ивент, Куратор/Ассистент ивентологии одобряют/отклоняют (см.
    # AccessContext.is_event_submitter/_assistant/_curator в app/api/deps.py)
    event_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    event_assistant_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    event_curator_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Discord-канал, куда бот шлёт сообщение об одобренном ивенте (Bot API, не
    # webhook — см. app/core/discord_client.py::send_channel_message)
    event_notify_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Роль, которую бот пингует в тексте сообщения об одобренном ивенте
    # (в дополнение к вложенной картинке-досье) — необязательно
    event_notify_ping_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Отдельная привилегия "может отклонить любой рапорт" — не привязана к
    # командиру/заму формирования или INS/DEP/CU, настраивается ролью и/или
    # конкретными людьми, как detention_report_role_ids выше
    report_reject_role_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    report_reject_user_discord_ids: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Администрация — нон-РП должность (модерация сервера: баны/муты/выдача
    # предметов), НЕ привязана к РП-формированию (боец может одновременно
    # состоять в полку и быть, например, Куратором администрации) — та же
    # независимая от Regiment ролевая система, что у Ивентрума выше, но с 5
    # ступенями вместо 2. См. AccessContext.admin_staff_rank_code/_tier в
    # app/api/deps.py.
    admin_staff_junior_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    admin_staff_middle_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    admin_staff_warden_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    admin_staff_assistant_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    admin_staff_curator_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Middle-должность (admin_staff_middle_role_id), которой точечно дали право
    # одобрять отчёты Администрации наравне с Senior (Варден+) — см. решение
    # пользователя ("ответственный Middle")
    admin_staff_responsible_middle_discord_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
