from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.rank import Rank
    from app.models.regiment import Regiment
    from app.models.user import User


CATEGORY_CLASS = "class"
CATEGORY_GEAR = "gear"
CATEGORY_SPECIALIZATION = "specialization"
CATEGORY_ADDITIONAL_SPECIALIZATION = "additional_specialization"
CATEGORY_ELITE_SPECIALIZATION = "elite_specialization"
# Дисциплины (подспециализации внутри общего класса — Медик/Пилот/Инженер, см.
# Specialization.parent_id): свой лимит по составу, как и у обычных категорий
# (RankTier.medic_limit и т.д.), но выдаёт их только инструктор соответствующей
# дисциплины (см. InstructorRole), а не любой инструктор
CATEGORY_MEDIC = "medic"
CATEGORY_PILOT = "pilot"
CATEGORY_ENGINEER = "engineer"
DISCIPLINE_CATEGORIES = [CATEGORY_MEDIC, CATEGORY_PILOT, CATEGORY_ENGINEER]

# Ветки джедаев (Защитники/Консулы/Стражи) — каждая со своими 2 специализациями,
# выбирается один раз (см. _check_can_grant: держать специализации из двух
# разных веток разом нельзя). Сознательно НЕ в DISCIPLINE_CATEGORIES — та
# завязана на RankTier.<category>_limit колонки и InstructorDiscipline Literal
# (медик/пилот/инженер, фиксированная тройка); выдавать джедайские ветки пока
# может любой инструктор, как обычную (не дисциплинарную) специализацию —
# точечный доступ через "Совет Ордена" сделать позже, отдельной фичей.
CATEGORY_JEDI_GUARDIAN = "jedi_guardian"
CATEGORY_JEDI_CONSULAR = "jedi_consular"
CATEGORY_JEDI_SENTINEL = "jedi_sentinel"
JEDI_BRANCH_CATEGORIES = [CATEGORY_JEDI_GUARDIAN, CATEGORY_JEDI_CONSULAR, CATEGORY_JEDI_SENTINEL]

# Иерархия внутри дисциплины — тот же принцип, что у командования формирования
# (командир/зам/боец), только по ветке (медик/пилот/инженер), не по формированию.
# Права нарастают по ступеням (см. AccessContext.is_discipline_deputy/_curator).
INSTRUCTOR_TIER_INSTRUCTOR = "instructor"
INSTRUCTOR_TIER_DEPUTY = "deputy"
INSTRUCTOR_TIER_CURATOR = "curator"
INSTRUCTOR_TIERS = [INSTRUCTOR_TIER_INSTRUCTOR, INSTRUCTOR_TIER_DEPUTY, INSTRUCTOR_TIER_CURATOR]
# Для сортировки ростера дисциплины сверху вниз: куратор -> зам -> инструктор ->
# просто держит специализацию (см. app/api/specializations.py::get_discipline_roster)
INSTRUCTOR_TIER_RANK = {
    INSTRUCTOR_TIER_CURATOR: 0,
    INSTRUCTOR_TIER_DEPUTY: 1,
    INSTRUCTOR_TIER_INSTRUCTOR: 2,
}
SPECIALIZATION_CATEGORIES = [
    CATEGORY_CLASS,
    CATEGORY_GEAR,
    CATEGORY_SPECIALIZATION,
    CATEGORY_ADDITIONAL_SPECIALIZATION,
    CATEGORY_ELITE_SPECIALIZATION,
    *DISCIPLINE_CATEGORIES,
    *JEDI_BRANCH_CATEGORIES,
]
# Специализация с этим кодом освобождает бойца от всех лимитов на обучение по
# составу (см. вики: "ЭРК [ARC] - Без ограничений")
UNLIMITED_TRAINING_CODE = "ARC"


class Specialization(Base):
    """Каталог специализаций/классов/снаряжения ВАР (Медик, Инженер, Штурмовик и
    т.д.) — общий для всех формирований, ведётся администратором. Выдаётся бойцу
    вручную инструктором (см. UserSpecialization), а не через рапорты/повышения.

    category — тип, по которому считаются лимиты на обучение по составу (см.
    RankTier.*_limit): "class" (общий класс), "gear" (общее снаряжение),
    "specialization" (общая специализация), "additional_specialization"
    (дополнительная специализация), "elite_specialization" (элитная)."""

    __tablename__ = "specializations"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(32), default=CATEGORY_SPECIALIZATION, server_default=CATEGORY_SPECIALIZATION)
    # Минимальное звание, необходимое бойцу, чтобы обучиться этой специализации
    # (см. вики: "Обучение доступно со звания PVT+") — None означает, что
    # минимального звания нет (ограничивают только лимиты по составу)
    min_rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    min_rank: Mapped["Rank | None"] = relationship()
    # Доп. требование по формированию — редкое (у большинства специализаций не
    # задано), но у некоторых обучение доступно только бойцам конкретного
    # формирования (например снаряжение/подспециализация, привязанная к части)
    required_regiment_id: Mapped[int | None] = mapped_column(ForeignKey("regiments.id"), nullable=True)
    required_regiment: Mapped["Regiment | None"] = relationship()
    # Подспециализация внутри общего класса (Медик -> Психолог/Физиотерапевт и
    # т.д., category у детей — одна из DISCIPLINE_CATEGORIES) — выдать её нельзя,
    # пока у бойца нет родительской (см. _check_can_grant)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("specializations.id"), nullable=True)
    parent: Mapped["Specialization | None"] = relationship(remote_side=[id])


class SpecializationPrerequisite(Base):
    """"Нужны ВСЕ из" — не то же самое, что parent_id (тот — "нужна ровно одна
    конкретная"). Для ступени "Старший" в дисциплине (см. решение пользователя):
    отдельная специализация (например "Старший медик"), которую можно выдать
    только тому, у кого уже есть КАЖДАЯ из веток корпуса разом (Вирусология +
    Дефектология + Хирургия), а не одна любая — parent_id для такого не подходит,
    он про единственного конкретного родителя. См. _check_can_grant."""

    __tablename__ = "specialization_prerequisites"
    __table_args__ = (
        UniqueConstraint("specialization_id", "required_specialization_id", name="uq_specialization_prerequisite"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    specialization_id: Mapped[int] = mapped_column(ForeignKey("specializations.id"))
    required_specialization_id: Mapped[int] = mapped_column(ForeignKey("specializations.id"))


class UserSpecialization(Base):
    """Факт выдачи конкретной специализации конкретному бойцу — кто выдал и когда,
    чтобы это было видно в личном деле (аналогично early_promoted_by у званий)."""

    __tablename__ = "user_specializations"
    __table_args__ = (UniqueConstraint("user_id", "specialization_id", name="uq_user_specialization"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    specialization_id: Mapped[int] = mapped_column(ForeignKey("specializations.id"))
    granted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    specialization: Mapped["Specialization"] = relationship()
    granted_by: Mapped["User"] = relationship(foreign_keys=[granted_by_user_id])


class SpecializationBan(Base):
    """Запрет бойцу на обучение — на конкретную специализацию (specialization_id
    задан) или на любое обучение вообще (specialization_id NULL). until_date —
    до указанной даты включительно; None означает бессрочный (постоянный)
    запрет. Показывается в личном деле пометкой вида "[PIL] до 13.10" (или
    "[PIL] навсегда" для бессрочного), как описано в вики."""

    __tablename__ = "specialization_bans"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    specialization_id: Mapped[int | None] = mapped_column(ForeignKey("specializations.id"), nullable=True)
    until_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    specialization: Mapped["Specialization | None"] = relationship()
    created_by: Mapped["User"] = relationship(foreign_keys=[created_by_user_id])


class InstructorRole(Base):
    """Discord-роль -> какие специализации она разрешает выдавать: конкретная
    дисциплина (discipline из DISCIPLINE_CATEGORIES — например "medic", видно
    только медицинские подспециализации) или can_teach_all=True (видно вообще
    всё — например роль "ARC | INS"). discipline=None и can_teach_all=False
    одновременно не имеет смысла, но допускается на уровне БД — проверяется в
    API. Одна Discord-роль -> одна запись (уникальность на discord_role_id).

    tier — иерархия внутри дисциплины (INSTRUCTOR_TIERS): обычный инструктор
    только выдаёт/снимает специализации; DEP/CU дополнительно получают
    расширенные права по своей ветке (см. AccessContext.is_discipline_deputy/
    _curator и все места, где это проверяется)."""

    __tablename__ = "instructor_roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    discord_role_id: Mapped[str] = mapped_column(String(32), unique=True)
    # Название роли на момент настройки — только для отображения в панели
    label: Mapped[str] = mapped_column(String(255))
    discipline: Mapped[str | None] = mapped_column(String(32), nullable=True)
    can_teach_all: Mapped[bool] = mapped_column(default=False, server_default="false")
    tier: Mapped[str] = mapped_column(
        String(16), default=INSTRUCTOR_TIER_INSTRUCTOR, server_default=INSTRUCTOR_TIER_INSTRUCTOR
    )
